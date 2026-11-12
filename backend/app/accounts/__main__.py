"""Reset a password from the terminal (there is no email sender in a local install).

    cd backend && .venv/bin/python -m app.accounts reset-password you@example.com

It prompts twice for the new password, applies the password rules, and signs out every device.
"""

from __future__ import annotations

import argparse
import getpass
from collections.abc import Callable, Sequence

from sqlalchemy import select

from app.db import Database

from .core import AccountInputError, check_password, hash_password, normalize_email, revoke_all_sessions
from .models import User


def main(argv: Sequence[str] | None = None, *, db: Database | None = None,
         prompt: Callable[[str], str] = getpass.getpass, out: Callable[[str], object] = print) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.accounts", description="AstroPlanner account tools.")
    commands = parser.add_subparsers(dest="command", required=True)
    reset = commands.add_parser("reset-password", help="Set a new password for an account.")
    reset.add_argument("email")
    args = parser.parse_args(argv)

    try:
        email = normalize_email(args.email)
    except AccountInputError as exc:
        out(exc.message)
        return 1
    if db is None:
        db = Database()
        db.init()
    with db.session() as s:
        user = s.scalar(select(User).where(User.email == email))
        if user is None:
            out("No account with that email.")
            return 1
        password = prompt("New password: ")
        if prompt("Repeat it: ") != password:
            out("Passwords don’t match.")
            return 1
        try:
            check_password(password)
        except AccountInputError as exc:
            out(exc.message)
            return 1
        user.password_hash = hash_password(password)
        revoke_all_sessions(s, user.id)
        s.commit()
    out(f"Password changed for {email}. Every device was signed out.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
