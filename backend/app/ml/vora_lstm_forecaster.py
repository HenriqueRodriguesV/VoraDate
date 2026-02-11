from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Tuple, Optional, Union

import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler, StandardScaler

import tensorflow as tf
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense, Dropout, Bidirectional
from tensorflow.keras.callbacks import EarlyStopping
from tensorflow.keras.optimizers import Adam, RMSprop


# =========================
# Leitura do .env do modelo
# =========================

def load_env_config(env_path: Union[str, Path]) -> Dict[str, str]:
    """
    Lê um arquivo .env simples (chave=valor) ignorando linhas em branco e comentários (#).
    Exemplo de linha válida: CHAVE=valor
    """
    env_path = Path(env_path)
    cfg: Dict[str, str] = {}
    with env_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            cfg[key.strip()] = value.strip()
    return cfg


def _get_str(cfg: Dict[str, str], key: str, default: Optional[str] = None, required: bool = False) -> str:
    v = cfg.get(key, None)
    if (v is None or v == "") and required:
        if default is None:
            raise ValueError(f"Config obrigatória ausente: {key}")
        return default
    if v is None or v == "":
        return default
    return v


def _get_int(cfg: Dict[str, str], key: str, default: Optional[int] = None, required: bool = False) -> int:
    v = cfg.get(key, None)
    if (v is None or v == "") and required and default is None:
        raise ValueError(f"Config obrigatória ausente: {key}")
    if v is None or v == "":
        if default is None:
            raise ValueError(f"Config obrigatória ausente: {key}")
        return default
    return int(v)


def _get_float(cfg: Dict[str, str], key: str, default: Optional[float] = None, required: bool = False) -> float:
    v = cfg.get(key, None)
    if (v is None or v == "") and required and default is None:
        raise ValueError(f"Config obrigatória ausente: {key}")
    if v is None or v == "":
        if default is None:
            raise ValueError(f"Config obrigatória ausente: {key}")
        return default
    return float(v)


def _get_bool(cfg: Dict[str, str], key: str, default: bool = False) -> bool:
    v = cfg.get(key, None)
    if v is None or v == "":
        return default
    return v.strip().lower() in ("1", "true", "t", "yes", "y", "sim")


def _parse_str_list(value: Optional[str]) -> List[str]:
    if not value:
        return []
    return [v.strip() for v in value.split(",") if v.strip()]


def _parse_int_list(value: Optional[str]) -> List[int]:
    return [int(v.strip()) for v in _parse_str_list(value)]


# =========================
# Preparação dos dados
# =========================

def prepare_time_series_data(
    df: pd.DataFrame,
    cfg: Dict[str, str]
) -> Tuple[pd.DataFrame, np.ndarray, Optional[object]]:
    """
    - Converte e ordena a coluna temporal
    - Trata missing nas colunas numéricas
    - Escala os dados (target + exógenas)
    Retorna:
      df_ordenado, data_scaled (np.ndarray), scaler (ou None)
    """
    datetime_col = _get_str(cfg, "DATETIME_COLUMN", required=True)
    target_col = _get_str(cfg, "TARGET_COLUMN", required=True)
    exog_cols = _parse_str_list(cfg.get("EXOG_COLUMNS", ""))

    df = df.copy()

    # ========= AJUSTE ESPECIAL PARA COLUNA "ANO" =========
    # Se a coluna de tempo for numérica e parecer um ANO (entre 1900 e 2100),
    # tratamos como ano calendário (2020 -> 2020-01-01 etc),
    # evitando aquele comportamento bizarro de 1970 + nanossegundos.
    col = df[datetime_col]

    try:
        from pandas.api.types import is_integer_dtype, is_float_dtype
        is_numeric = is_integer_dtype(col) or is_float_dtype(col)
    except Exception:
        # fallback se der algum problema no import
        is_numeric = False

    if is_numeric and col.dropna().between(1900, 2100).all():
        # Trata como ano: converte pra string e usa o formato %Y
        df[datetime_col] = pd.to_datetime(col.astype(int).astype(str), format="%Y")
    else:
        # Caso geral: deixa o pandas converter do jeito padrão
        df[datetime_col] = pd.to_datetime(col)

    # Ordena pela coluna temporal
    df = df.sort_values(datetime_col).reset_index(drop=True)
    # ========= FIM DO AJUSTE DA COLUNA DE TEMPO =========

    # Colunas numéricas usadas pelo modelo
    numeric_cols = [target_col] + exog_cols

    # Converte para numérico (erros viram NaN)
    for col_num in numeric_cols:
        df[col_num] = pd.to_numeric(df[col_num], errors="coerce")

    # Tratamento de missing conforme config
    fill_method = cfg.get("FILL_MISSING", "ffill").lower()
    if fill_method == "ffill":
        df[numeric_cols] = df[numeric_cols].ffill().bfill()
    elif fill_method == "bfill":
        df[numeric_cols] = df[numeric_cols].bfill().ffill()
    elif fill_method == "mean":
        df[numeric_cols] = df[numeric_cols].fillna(df[numeric_cols].mean())
    elif fill_method == "median":
        df[numeric_cols] = df[numeric_cols].fillna(df[numeric_cols].median())
    elif fill_method == "zero":
        df[numeric_cols] = df[numeric_cols].fillna(0.0)
    elif fill_method == "drop":
        df = df.dropna(subset=numeric_cols)
    else:
        # fallback: forward + backward fill
        df[numeric_cols] = df[numeric_cols].ffill().bfill()

    # Matriz de dados numéricos
    data = df[numeric_cols].values.astype("float32")

    # Escalonamento
    scale_method = cfg.get("SCALE_METHOD", "MINMAX").upper()
    scaler = None
    if scale_method == "STANDARD":
        scaler = StandardScaler()
        data_scaled = scaler.fit_transform(data)
    elif scale_method == "NONE":
        data_scaled = data
    else:
        # MINMAX default
        scaler = MinMaxScaler()
        data_scaled = scaler.fit_transform(data)

    return df, data_scaled, scaler

def create_sequences(
    data: np.ndarray,
    window: int,
    horizon: int,
    step: int = 1,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Cria janelas de treinamento:
      X: [janela_passado, n_features]
      y: [horizonte_futuro] (somente target)
    """
    X, y = [], []
    n_samples = len(data)

    max_start = n_samples - window - horizon + 1
    for start in range(0, max_start, step):
        end = start + window
        X.append(data[start:end, :])
        y.append(data[end : end + horizon, 0])

    return np.array(X, dtype="float32"), np.array(y, dtype="float32")


# =========================
# Modelo LSTM
# =========================

def rmse_metric(y_true, y_pred):
    return tf.sqrt(tf.reduce_mean(tf.square(y_pred - y_true)))


def build_lstm_from_config(
    input_window: int,
    n_features: int,
    horizon: int,
    cfg: Dict[str, str],
) -> tf.keras.Model:
    """
    Monta uma LSTM sofisticada conforme o .env:
      - múltiplas camadas LSTM
      - bidirecional opcional
      - dropout normal, recorrente e entre camadas
      - camadas densas finais
    """
    lstm_layers = _parse_int_list(cfg.get("LSTM_LAYERS", "64"))
    dense_layers = _parse_int_list(cfg.get("DENSE_LAYERS", ""))

    dropout_lstm = _get_float(cfg, "DROPOUT_LSTM", 0.2)
    recurrent_dropout = _get_float(cfg, "DROPOUT_RECURRENT", 0.0)
    dropout_between_lstm = _get_float(cfg, "DROPOUT_BETWEEN_LSTM", 0.0)
    dropout_dense = _get_float(cfg, "DROPOUT_DENSE", 0.0)

    bidirectional = _get_bool(cfg, "BIDIRECTIONAL", False)

    loss_fn = cfg.get("LOSS_FUNCTION", "mse")
    optimizer_name = cfg.get("OPTIMIZER", "adam").lower()
    learning_rate = _get_float(cfg, "LEARNING_RATE", 1e-3)

    metric_names = _parse_str_list(cfg.get("METRICS", "mse,mae,rmse"))

    metrics = []
    for m in metric_names:
        m_low = m.lower()
        if m_low == "rmse":
            metrics.append(rmse_metric)
        elif m_low in ("mse", "mae"):
            metrics.append(m_low)

    if optimizer_name == "rmsprop":
        optimizer = RMSprop(learning_rate=learning_rate)
    else:
        optimizer = Adam(learning_rate=learning_rate)

    model = Sequential()

    # Empilha camadas LSTM
    for i, units in enumerate(lstm_layers):
        return_sequences = i < len(lstm_layers) - 1

        lstm_kwargs = dict(
            units=units,
            activation="tanh",
            return_sequences=return_sequences,
            dropout=dropout_lstm,
            recurrent_dropout=recurrent_dropout,
        )

        if i == 0:
            lstm_kwargs["input_shape"] = (input_window, n_features)

        if bidirectional:
            lstm_layer = Bidirectional(LSTM(**lstm_kwargs))
        else:
            lstm_layer = LSTM(**lstm_kwargs)

        model.add(lstm_layer)

        # Dropout extra entre LSTM, se configurado
        if return_sequences and dropout_between_lstm > 0.0:
            model.add(Dropout(dropout_between_lstm))

    # Camadas densas finais
    for units in dense_layers:
        model.add(Dense(units, activation="relu"))
        if dropout_dense > 0.0:
            model.add(Dropout(dropout_dense))

    # Saída: horizonte completo
    model.add(Dense(horizon))

    model.compile(
        loss=loss_fn,
        optimizer=optimizer,
        metrics=metrics,
    )

    return model


# =========================
# Pipeline completo
# =========================

def train_and_forecast_from_env(env_path: Union[str, Path]):
    """
    Pipeline completo:
      - lê config_vora_lstm.env
      - carrega CSV
      - prepara dados
      - treina modelo LSTM
      - gera previsão com horizonte configurado

    Retorna:
      model: modelo treinado
      history: dicionário com histórico de treino
      forecast_df: DataFrame com datas futuras + previsão
    """
    cfg = load_env_config(env_path)

    # Seed para reprodutibilidade
    seed = _get_int(cfg, "RANDOM_SEED", 42)
    np.random.seed(seed)
    tf.random.set_seed(seed)

    csv_path = _get_str(cfg, "CSV_PATH", required=True)
    datetime_col = _get_str(cfg, "DATETIME_COLUMN", required=True)
    target_col = _get_str(cfg, "TARGET_COLUMN", required=True)

    df = pd.read_csv(csv_path)
    df, data_scaled, scaler = prepare_time_series_data(df, cfg)

    history_window = _get_int(cfg, "HISTORY_WINDOW", 60)
    forecast_horizon = _get_int(cfg, "FORECAST_HORIZON", 30)
    window_step = _get_int(cfg, "WINDOW_STEP", 1)

    X, y = create_sequences(data_scaled, history_window, forecast_horizon, step=window_step)

    if len(X) < 2:
        raise ValueError("Poucos dados para criar janelas. Ajuste HISTORY_WINDOW e FORECAST_HORIZON.")

    train_split = float(cfg.get("TRAIN_TEST_SPLIT", 0.8))
    n_samples = len(X)
    n_train = max(1, int(n_samples * train_split))
    n_train = min(n_train, n_samples - 1)

    X_train, X_val = X[:n_train], X[n_train:]
    y_train, y_val = y[:n_train], y[n_train:]

    n_features = X.shape[2]
    model = build_lstm_from_config(history_window, n_features, forecast_horizon, cfg)

    epochs = _get_int(cfg, "EPOCHS", 50)
    batch_size = _get_int(cfg, "BATCH_SIZE", 32)
    shuffle_train = _get_bool(cfg, "SHUFFLE_TRAIN", False)

    use_early_stopping = _get_bool(cfg, "USE_EARLY_STOPPING", True)
    early_patience = _get_int(cfg, "EARLY_STOP_PATIENCE", 5)
    early_min_delta = _get_float(cfg, "EARLY_STOP_MIN_DELTA", 0.0)

    callbacks = []
    if use_early_stopping and len(X_val) > 0:
        callbacks.append(
            EarlyStopping(
                monitor="val_loss",
                patience=early_patience,
                min_delta=early_min_delta,
                restore_best_weights=True,
            )
        )

    fit_kwargs = dict(
        x=X_train,
        y=y_train,
        epochs=epochs,
        batch_size=batch_size,
        shuffle=shuffle_train,
        verbose=1,
    )

    if len(X_val) > 0:
        fit_kwargs["validation_data"] = (X_val, y_val)
    if callbacks:
        fit_kwargs["callbacks"] = callbacks

    history_obj = model.fit(**fit_kwargs)
    history = history_obj.history

    # Previsão usando a última janela
    last_window = data_scaled[-history_window:, :].reshape(1, history_window, n_features)
    forecast_scaled = model.predict(last_window)
    forecast_scaled = forecast_scaled[0]

    # Desescalar somente o target
    if scaler is not None:
        dummy = np.zeros((forecast_horizon, data_scaled.shape[1]), dtype="float32")
        dummy[:, 0] = forecast_scaled
        dummy_inversed = scaler.inverse_transform(dummy)
        forecast_values = dummy_inversed[:, 0]
    else:
        forecast_values = forecast_scaled

    # Construir datas futuras
    last_date = df[datetime_col].iloc[-1]
    freq = cfg.get("FREQUENCY", "D")

    try:
        offset = pd.tseries.frequencies.to_offset(freq)
    except (ValueError, TypeError):
        inferred = pd.infer_freq(df[datetime_col])
        if inferred is None:
            inferred = "D"
        freq = inferred
        offset = pd.tseries.frequencies.to_offset(freq)

    future_dates = pd.date_range(
        start=last_date + offset,
        periods=forecast_horizon,
        freq=freq,
    )

    forecast_df = pd.DataFrame(
        {
            datetime_col: future_dates,
            f"forecast_{target_col}": forecast_values,
        }
    )

    # Salvar, se configurado
    save_model_path = cfg.get("SAVE_MODEL_PATH", "").strip()
    if save_model_path:
        Path(save_model_path).parent.mkdir(parents=True, exist_ok=True)
        model.save(save_model_path)

    save_forecast_path = cfg.get("SAVE_FORECAST_CSV_PATH", "").strip()
    if save_forecast_path:
        Path(save_forecast_path).parent.mkdir(parents=True, exist_ok=True)
        forecast_df.to_csv(save_forecast_path, index=False)

    return model, history, forecast_df


if __name__ == "__main__":
    # Teste local:
    # rode a partir da pasta backend:
    #   python -m app.ml.vora_lstm_forecaster
    env_file = "config_vora_lstm.env"
    model, history, forecast_df = train_and_forecast_from_env(env_file)
    print("Primeiras linhas da previsão:")
    print(forecast_df.head())
