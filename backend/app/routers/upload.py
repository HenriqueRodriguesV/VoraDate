from fastapi import APIRouter, UploadFile, File, HTTPException, Form
from typing import Optional
from pathlib import Path
import re

router = APIRouter(
    prefix="/upload",
    tags=["upload"],
)

# Diretório base do projeto (pasta backend/)
BASE_DIR = Path(__file__).resolve().parents[2]
BASE_UPLOAD_DIR = BASE_DIR / "uploads"
BASE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def safe_folder_name(raw: str) -> str:
    """
    Gera um nome de pasta seguro a partir do email / nome.
    Exemplo:
        'luccasarai vaborges@gmail.com' -> 'luccasarai_vaborges'
        'Lucas Saraiva'                 -> 'lucas_saraiva'
    """
    raw = (raw or "").strip().lower()

    # Se for email, usa só a parte antes do @ (fica mais limpo)
    if "@" in raw:
        raw = raw.split("@")[0]

    # Troca qualquer caractere estranho por "_"
    safe = re.sub(r"[^a-z0-9._-]", "_", raw)

    return safe or "usuario"


@router.post("/dataset")
async def upload_dataset(
    file: UploadFile = File(...),
    user_email: Optional[str] = Form(None),
):
    """
    Recebe um arquivo CSV / JSON / Excel, salva em uploads/<pasta_do_usuario>/
    e devolve informações básicas.
    """
    # 1) Validar extensão
    ext = file.filename.split(".")[-1].lower()
    if ext not in {"csv", "json", "xlsx", "xls"}:
        raise HTTPException(status_code=400, detail="Tipo de arquivo não suportado")

    # 2) Definir pasta do usuário
    if user_email:
        user_folder = safe_folder_name(user_email)
    else:
        user_folder = "anonimo"

    user_dir = BASE_UPLOAD_DIR / user_folder
    user_dir.mkdir(parents=True, exist_ok=True)

    # 3) Ler conteúdo do arquivo
    content = await file.read()

    # 4) Salvar arquivo
    save_path = user_dir / file.filename
    with open(save_path, "wb") as f:
        f.write(content)

    # 5) Resposta
    return {
        "ok": True,
        "filename": file.filename,
        "user_folder": user_folder,
        "path": str(save_path),
        "size_bytes": len(content),
        "message": "Arquivo recebido com sucesso",
    }
