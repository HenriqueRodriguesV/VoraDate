from __future__ import annotations

import math
import re
from pathlib import Path
from typing import List, Optional, Dict, Any

import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.ml.vora_lstm_forecaster import (
    train_and_forecast_from_env,
    load_env_config,
)

router = APIRouter(prefix="/forecast", tags=["forecast"])

# --------- BASE DE PASTAS (mesmo padrão de upload/cleaning) ---------

BASE_DIR = Path(__file__).resolve().parents[2]          # pasta backend/
BASE_UPLOAD_DIR = BASE_DIR / "uploads"
BASE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def safe_folder_name(raw: Optional[str]) -> str:
    """
    Gera nome de pasta seguro a partir do email / nome.
    Usa a mesma lógica que upload.py / cleaning.py.
    """
    raw = (raw or "").strip().lower()
    if "@" in raw:
        raw = raw.split("@")[0]
    safe = re.sub(r"[^a-z0-9._-]", "_", raw)
    return safe or "anonimo"


def get_user_dir(user_email: Optional[str]) -> Path:
    folder = safe_folder_name(user_email)
    user_dir = BASE_UPLOAD_DIR / folder
    user_dir.mkdir(parents=True, exist_ok=True)
    return user_dir


# --------- MODELOS Pydantic ---------


class ForecastRequest(BaseModel):
    # nome do arquivo salvo em uploads/<user_folder>/ (pode ser bruto ou _cleaned)
    filename: str
    user_email: Optional[str] = None  # usado para localizar a pasta do usuário


class TimePoint(BaseModel):
    date: str
    value: float


class ForecastResponse(BaseModel):
    ok: bool
    filename: str
    history: List[TimePoint]
    forecast: List[TimePoint]
    metrics: Dict[str, Any]
    forecast_csv_filename: Optional[str] = None  # nome do CSV salvo com a previsão


# --------- ENDPOINT LSTM ---------


@router.post("/lstm", response_model=ForecastResponse)
def run_lstm_forecast(body: ForecastRequest):
    """
    Usa o vora_lstm_forecaster para treinar o modelo e devolver:
    - série histórica (original/limpa)
    - forecast
    - métricas básicas (MSE, MAE, RMSE, épocas)
    - nome do arquivo CSV de forecast salvo com sufixo _forecast
    """

    # 1) valida o nome do arquivo passado na requisição
    safe_name = Path(body.filename).name
    if safe_name != body.filename or ".." in body.filename or "/" in body.filename or "\\" in body.filename:
        raise HTTPException(status_code=400, detail="Nome de arquivo inválido.")

    # 2) Descobre a pasta do usuário e o arquivo a usar (prioriza *_cleaned se existir)
    user_dir = get_user_dir(body.user_email)
    requested_path = user_dir / safe_name

    if requested_path.exists():
        csv_path = requested_path
    else:
        # Se não existe o que foi pedido, tenta automaticamente o *_cleaned
        p = Path(safe_name)
        cleaned_name = f"{p.stem}_cleaned{p.suffix}"
        cleaned_path = user_dir / cleaned_name
        if cleaned_path.exists():
            csv_path = cleaned_path
            safe_name = cleaned_name
        else:
            raise HTTPException(
                status_code=404,
                detail=f"Arquivo '{requested_path.name}' não encontrado na pasta do usuário e nenhum arquivo *_cleaned correspondente foi localizado.",
            )

    # 3) base do .env (na raiz do backend: backend/config_vora_lstm.env)
    base_env_path = BASE_DIR / "config_vora_lstm.env"
    if not base_env_path.exists():
        raise HTTPException(
            status_code=500,
            detail="Arquivo 'config_vora_lstm.env' não encontrado no backend.",
        )

    # 4) monta caminhos relativos para CSV de entrada e CSV de forecast
    user_folder = safe_folder_name(body.user_email)
    csv_rel_path = f"./uploads/{user_folder}/{csv_path.name}"

    stem = csv_path.stem
    suffix = csv_path.suffix
    forecast_name = f"{stem}_forecast{suffix}"
    forecast_rel_path = f"./uploads/{user_folder}/{forecast_name}"

    # 5) gera um .env runtime apontando para o CSV certo + caminho de forecast
    lines = base_env_path.read_text(encoding="utf-8").splitlines()
    new_lines: List[str] = []
    found_csv = False
    found_save_forecast = False

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("CSV_PATH="):
            new_lines.append(f"CSV_PATH={csv_rel_path}")
            found_csv = True
        elif stripped.startswith("SAVE_FORECAST_CSV_PATH="):
            new_lines.append(f"SAVE_FORECAST_CSV_PATH={forecast_rel_path}")
            found_save_forecast = True
        else:
            new_lines.append(line)

    if not found_csv:
        new_lines.append(f"CSV_PATH={csv_rel_path}")
    if not found_save_forecast:
        new_lines.append(f"SAVE_FORECAST_CSV_PATH={forecast_rel_path}")

    runtime_env_path = base_env_path.parent / "config_vora_lstm_runtime.env"
    runtime_env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")

    # 6) treina e gera forecast
    try:
        model, history_dict, forecast_df = train_and_forecast_from_env(runtime_env_path)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao treinar modelo/prever: {e}",
        )

    # 7) carrega config pra saber coluna de data e target
    cfg = load_env_config(runtime_env_path)
    datetime_col = cfg.get("DATETIME_COLUMN")
    target_col = cfg.get("TARGET_COLUMN")

    if not datetime_col or not target_col:
        raise HTTPException(
            status_code=500,
            detail="DATETIME_COLUMN ou TARGET_COLUMN não configurados no .env.",
        )

    # 8) monta série histórica (arquivo usado no treino: bruto ou *_cleaned)
    try:
        df_raw = pd.read_csv(csv_path)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao ler CSV original/limpo: {e}",
        )

    try:
        df_raw[datetime_col] = pd.to_datetime(df_raw[datetime_col])
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao converter coluna de data '{datetime_col}': {e}",
        )

    df_raw = df_raw.sort_values(datetime_col)

    history_list: List[TimePoint] = []
    for _, row in df_raw[[datetime_col, target_col]].dropna().iterrows():
        history_list.append(
            TimePoint(
                date=row[datetime_col].isoformat(),
                value=float(row[target_col]),
            )
        )

    # 9) monta forecast (datas futuras + previsão)
    if datetime_col not in forecast_df.columns:
        raise HTTPException(
            status_code=500,
            detail="Forecast retornou em formato inesperado.",
        )

    forecast_cols = [c for c in forecast_df.columns if c != datetime_col]
    if not forecast_cols:
        raise HTTPException(
            status_code=500,
            detail="Forecast retornou sem coluna de previsão.",
        )
    forecast_col = forecast_cols[0]

    forecast_list: List[TimePoint] = []
    for _, row in forecast_df[[datetime_col, forecast_col]].iterrows():
        forecast_list.append(
            TimePoint(
                date=row[datetime_col].isoformat(),
                value=float(row[forecast_col]),
            )
        )

    # 10) extrai métricas do histórico de treino
    metrics: Dict[str, Any] = {}

    if isinstance(history_dict, dict):
        def last_or_none(*names: str) -> Optional[float]:
            for n in names:
                seq = history_dict.get(n)
                if isinstance(seq, (list, tuple)) and seq:
                    try:
                        return float(seq[-1])
                    except (TypeError, ValueError):
                        continue
            return None

        mse = last_or_none("val_mse", "mse")
        mae = last_or_none("val_mae", "mae")
        rmse_hist = last_or_none("val_rmse_metric", "rmse_metric")

        if rmse_hist is not None:
            rmse = rmse_hist
        elif mse is not None:
            rmse = math.sqrt(mse)
        else:
            rmse = None

        if mse is not None:
            metrics["mse"] = mse
        if mae is not None:
            metrics["mae"] = mae
        if rmse is not None:
            metrics["rmse"] = rmse

        if "loss" in history_dict:
            metrics["train_epochs"] = len(history_dict["loss"])

    return ForecastResponse(
        ok=True,
        filename=csv_path.name,
        history=history_list,
        forecast=forecast_list,
        metrics=metrics,
        forecast_csv_filename=forecast_name,
    )
