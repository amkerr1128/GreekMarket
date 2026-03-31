import sys
from pathlib import Path

from alembic import command
from alembic.config import Config as AlembicConfig
from sqlalchemy import inspect

BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from app import _backfill_legacy_schema, create_app, db

ALEMBIC_INI = BASE_DIR / "migrations" / "alembic.ini"
SCRIPT_LOCATION = BASE_DIR / "migrations"


def build_alembic_config() -> AlembicConfig:
    config = AlembicConfig(str(ALEMBIC_INI))
    config.set_main_option("script_location", str(SCRIPT_LOCATION))
    config.set_main_option("sqlalchemy.url", str(db.engine.url).replace("%", "%%"))
    return config


def main() -> None:
    app = create_app()
    with app.app_context():
        inspector = inspect(db.engine)
        tables = set(inspector.get_table_names())
        alembic_config = build_alembic_config()

        if "alembic_version" in tables:
            command.upgrade(alembic_config, "head")
            return

        if not tables:
            print("No schema detected; bootstrapping current models before stamping migration head.")
            db.create_all()
            _backfill_legacy_schema()
            command.stamp(alembic_config, "head")
            return

        if tables:
            print("Detected existing schema without alembic_version; stamping current head.")
            command.stamp(alembic_config, "head")
            return


if __name__ == "__main__":
    main()
