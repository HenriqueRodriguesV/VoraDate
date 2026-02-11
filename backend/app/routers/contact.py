from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr
from typing import Optional
from email.message import EmailMessage
from dotenv import load_dotenv
import os
import smtplib

load_dotenv()

router = APIRouter(tags=["Contato"])

EMAIL_HOST = os.getenv("EMAIL_HOST")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", 587))
EMAIL_USER = os.getenv("EMAIL_USER")
EMAIL_PASS = os.getenv("EMAIL_PASS")
EMAIL_TO = os.getenv("EMAIL_TO")


class ContactRequest(BaseModel):
    nome: str
    empresa: Optional[str] = None
    email: EmailStr
    mensagem: str


def send_contact_email(data: ContactRequest):
    if not EMAIL_HOST or not EMAIL_USER or not EMAIL_PASS or not EMAIL_TO:
        raise RuntimeError("Configuração de e-mail inválida. Verifique o arquivo .env")

    msg = EmailMessage()
    msg["Subject"] = "Novo contato pelo site VORA"
    msg["From"] = f"Site VORA <{EMAIL_USER}>"
    msg["To"] = EMAIL_TO

    corpo = f"""
    Novo contato recebido pelo site:

    Nome: {data.nome}
    Empresa: {data.empresa or '-'}
    E-mail: {data.email}

    Mensagem:
    {data.mensagem}
    """

    msg.set_content(corpo)

    try:
        if EMAIL_PORT == 465:
            with smtplib.SMTP_SSL(EMAIL_HOST, EMAIL_PORT) as server:
                server.login(EMAIL_USER, EMAIL_PASS)
                server.send_message(msg)
        else:
            with smtplib.SMTP(EMAIL_HOST, EMAIL_PORT) as server:
                server.ehlo()
                server.starttls()
                server.ehlo()
                server.login(EMAIL_USER, EMAIL_PASS)
                server.send_message(msg)
    except Exception as e:
        raise RuntimeError(f"Erro geral ao enviar e-mail: {e}")


@router.post("/contact")
async def contact(payload: ContactRequest):
    try:
        send_contact_email(payload)
        return {"ok": True}
    except Exception as e:
        print("Erro ao enviar email:", repr(e))
        raise HTTPException(status_code=500, detail=str(e))
