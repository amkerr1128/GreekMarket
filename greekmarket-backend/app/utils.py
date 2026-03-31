def to_int(value):
    """Best-effort integer coercion for request/JWT payload IDs."""
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
