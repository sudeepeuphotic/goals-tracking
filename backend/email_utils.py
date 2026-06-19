# Email utility — Resend with graceful fallback to logging.
import os
import asyncio
import logging

import resend

logger = logging.getLogger(__name__)

RESEND_API_KEY = os.environ.get('RESEND_API_KEY', '')
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'onboarding@resend.dev')


def _is_configured() -> bool:
    return bool(RESEND_API_KEY and RESEND_API_KEY.startswith("re_"))


async def send_email(to: str, subject: str, html: str) -> dict:
    """Send a single transactional email via Resend.
    Returns {sent: bool, id?: str, fallback?: 'console'}.
    Never raises; on any failure we log and fall back to console logging."""
    if not _is_configured():
        logger.info(f"[EMAIL_FALLBACK] RESEND_API_KEY not set. TO={to} SUBJECT={subject}\n{html}")
        return {"sent": False, "fallback": "console"}
    resend.api_key = RESEND_API_KEY
    params = {"from": SENDER_EMAIL, "to": [to], "subject": subject, "html": html}
    try:
        email = await asyncio.to_thread(resend.Emails.send, params)
        logger.info(f"[EMAIL_SENT] id={email.get('id')} to={to}")
        return {"sent": True, "id": email.get("id")}
    except Exception as e:
        logger.exception("Resend send failed — falling back to console")
        logger.info(f"[EMAIL_FALLBACK] TO={to} SUBJECT={subject}\n{html}")
        return {"sent": False, "fallback": "console", "error": str(e)[:200]}


def password_reset_html(name: str, reset_link: str) -> str:
    return _layout_html(
        title="Reset your password",
        greeting=name,
        body_html=f"""
          <p style="margin:0 0 16px;font-size:14px;color:#0A0A0A;">
            Click the button below to set a new password. This link expires in 60 minutes and can be used once.
          </p>
          <a href="{reset_link}" style="display:inline-block;background:#0A0A0A;color:#fff;padding:10px 16px;text-decoration:none;font-size:14px;">Reset password →</a>
          <p style="margin:20px 0 0;font-size:12px;color:#525252;">Or paste this link:<br><span style="font-family:'IBM Plex Mono',monospace;">{reset_link}</span></p>
          <p style="margin:20px 0 0;font-size:12px;color:#525252;">Didn't ask for this? You can ignore this email.</p>
        """,
    )


def _layout_html(title: str, greeting: str, body_html: str) -> str:
    return f"""
    <!doctype html><html><body style="font-family: -apple-system, Helvetica, sans-serif; background:#F7F7F5; padding:24px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px; margin:0 auto; background:#fff; border:1px solid #0A0A0A;">
        <tr><td style="padding:24px 28px;">
          <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#525252;">NOSH / FOCUS-CYCLE</div>
          <h1 style="margin:8px 0 16px;font-size:22px;letter-spacing:-.02em;">{title}</h1>
          <p style="margin:0 0 16px;font-size:14px;color:#0A0A0A;">Hi {greeting or 'there'},</p>
          {body_html}
        </td></tr>
      </table>
    </body></html>
    """


def _goals_list_html(goals: list) -> str:
    if not goals:
        return ""
    items = "".join(
        f'<li style="margin:4px 0;font-size:14px;color:#0A0A0A;">{g}</li>'
        for g in goals
    )
    return f"""
      <p style="margin:16px 0 8px;font-size:13px;font-weight:600;color:#0A0A0A;">Assigned goals</p>
      <ul style="margin:0;padding-left:20px;">{items}</ul>
    """


def objective_assigned_html(
    recipient_name: str,
    objective_title: str,
    role_label: str,
    assigned_by: str,
    objective_link: str,
    description: str = "",
    goals: list | None = None,
) -> str:
    desc_block = ""
    if description:
        desc_block = f'<p style="margin:0 0 12px;font-size:14px;color:#525252;">{description}</p>'
    return _layout_html(
        title="New objective assigned",
        greeting=recipient_name,
        body_html=f"""
          <p style="margin:0 0 12px;font-size:14px;color:#0A0A0A;">
            <strong>{assigned_by}</strong> assigned you as <strong>{role_label}</strong> on:
          </p>
          <p style="margin:0 0 8px;font-size:16px;font-weight:600;color:#0A0A0A;">{objective_title}</p>
          {desc_block}
          {_goals_list_html(goals or [])}
          <p style="margin:20px 0 0;">
            <a href="{objective_link}" style="display:inline-block;background:#0A0A0A;color:#fff;padding:10px 16px;text-decoration:none;font-size:14px;">View objective →</a>
          </p>
        """,
    )


def objective_updated_html(
    recipient_name: str,
    objective_title: str,
    updated_by: str,
    objective_link: str,
    changes: list | None = None,
) -> str:
    changes_block = ""
    if changes:
        items = "".join(
            f'<li style="margin:4px 0;font-size:14px;color:#0A0A0A;">{c}</li>'
            for c in changes
        )
        changes_block = f"""
          <p style="margin:16px 0 8px;font-size:13px;font-weight:600;color:#0A0A0A;">What changed</p>
          <ul style="margin:0;padding-left:20px;">{items}</ul>
        """
    return _layout_html(
        title="Objective updated",
        greeting=recipient_name,
        body_html=f"""
          <p style="margin:0 0 12px;font-size:14px;color:#0A0A0A;">
            <strong>{updated_by}</strong> updated an objective you're on:
          </p>
          <p style="margin:0 0 8px;font-size:16px;font-weight:600;color:#0A0A0A;">{objective_title}</p>
          {changes_block}
          <p style="margin:20px 0 0;">
            <a href="{objective_link}" style="display:inline-block;background:#0A0A0A;color:#fff;padding:10px 16px;text-decoration:none;font-size:14px;">View objective →</a>
          </p>
        """,
    )


def goals_assigned_html(
    recipient_name: str,
    objective_title: str,
    assigned_by: str,
    objective_link: str,
    goals: list,
) -> str:
    return _layout_html(
        title="Goals assigned to you",
        greeting=recipient_name,
        body_html=f"""
          <p style="margin:0 0 12px;font-size:14px;color:#0A0A0A;">
            <strong>{assigned_by}</strong> assigned goals for <strong>{objective_title}</strong>:
          </p>
          {_goals_list_html(goals)}
          <p style="margin:20px 0 0;">
            <a href="{objective_link}" style="display:inline-block;background:#0A0A0A;color:#fff;padding:10px 16px;text-decoration:none;font-size:14px;">View goals →</a>
          </p>
        """,
    )
