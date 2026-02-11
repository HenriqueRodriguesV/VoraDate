from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from pathlib import Path
import re

import pandas as pd

router = APIRouter(
    prefix="/clean",
    tags=["cleaning"],
)

# Diretório base do projeto (pasta backend/)
BASE_DIR = Path(__file__).resolve().parents[2]
BASE_UPLOAD_DIR = BASE_DIR / "uploads"
BASE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def safe_folder_name(raw: str) -> str:
    """Mesma lógica do upload.py."""
    raw = (raw or "").strip().lower()

    if "@" in raw:
        raw = raw.split("@")[0]

    safe = re.sub(r"[^a-z0-9._-]", "_", raw)
    return safe or "usuario"


def get_user_dir(user_email: Optional[str]) -> Path:
    """Retorna uploads/<pasta_do_usuario> (ou uploads/anonimo)."""
    if user_email:
        folder = safe_folder_name(user_email)
    else:
        folder = "anonimo"
    user_dir = BASE_UPLOAD_DIR / folder
    user_dir.mkdir(parents=True, exist_ok=True)
    return user_dir


def load_dataframe(path: Path) -> pd.DataFrame:
    """Lê CSV / JSON / Excel em DataFrame pandas."""
    suffix = path.suffix.lower()

    if suffix in [".csv", ".txt"]:
        return pd.read_csv(path)
    elif suffix == ".json":
        return pd.read_json(path)
    elif suffix in [".xlsx", ".xls"]:
        return pd.read_excel(path)
    else:
        raise ValueError(f"Extensão não suportada para limpeza: {suffix}")


class CleanRequest(BaseModel):
    filename: str
    user_email: Optional[str] = None
    remove_duplicates: bool = True
    fix_missing: bool = True
    standardize_formats: bool = True


@router.post("/dataset")
async def clean_dataset(req: CleanRequest):
    """
    Aplica limpeza ao arquivo salvo em uploads/<pasta_do_usuario>/<filename>.
    """
    user_dir = get_user_dir(req.user_email)
    file_path = user_dir / req.filename

    if not file_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Arquivo não encontrado para este usuário: {file_path}",
        )

    try:
        df = load_dataframe(file_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Erro ao ler arquivo: {e}")

    rows_before = len(df)

    # Remover duplicados
    if req.remove_duplicates:
        df_no_dups = df.drop_duplicates()
        duplicates_removed = rows_before - len(df_no_dups)
        df = df_no_dups
    else:
        duplicates_removed = 0

    # Valores vazios antes
    missing_before = int(df.isna().sum().sum())

    # Corrigir valores vazios
    if req.fix_missing:
        for col in df.columns:
            if df[col].isna().sum() == 0:
                continue

            if pd.api.types.is_numeric_dtype(df[col]):
                median = df[col].median()
                df[col] = df[col].fillna(median)
            else:
                mode = df[col].mode(dropna=True)
                fill_value = mode.iloc[0] if not mode.empty else ""
                df[col] = df[col].fillna(fill_value)

    missing_after = int(df.isna().sum().sum())

    # Padronizar formatos simples (strings)
    if req.standardize_formats:
        for col in df.select_dtypes(include=["object", "string"]).columns:
            df[col] = df[col].astype(str).str.strip()
        formats_standardized = True
    else:
        formats_standardized = False

    rows_after = len(df)

    # Salvar arquivo limpo na mesma pasta
    cleaned_name = file_path.stem + "_cleaned" + file_path.suffix
    cleaned_path = file_path.with_name(cleaned_name)

    try:
        suffix = cleaned_path.suffix.lower()
        if suffix in [".csv", ".txt"]:
            df.to_csv(cleaned_path, index=False)
        elif suffix == ".json":
            df.to_json(cleaned_path, orient="records", force_ascii=False)
        elif suffix in [".xlsx", ".xls"]:
            df.to_excel(cleaned_path, index=False)
        else:
            cleaned_path = cleaned_path.with_suffix(".csv")
            cleaned_name = cleaned_path.name
            df.to_csv(cleaned_path, index=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao salvar arquivo limpo: {e}")

    # Prévia para a interface
    preview = df.head(10)
    preview_headers: List[str] = list(preview.columns)
    preview_rows = preview.values.tolist()

    return {
        "ok": True,
        "cleaned_filename": cleaned_name,
        "cleaned_path": str(cleaned_path),
        "rows_before": int(rows_before),
        "rows_after": int(rows_after),
        "duplicates_removed": int(duplicates_removed),
        "missing_before": int(missing_before),
        "missing_after": int(missing_after),
        "formats_standardized": formats_standardized,
        "preview_headers": preview_headers,
        "preview_rows": preview_rows,
    }
