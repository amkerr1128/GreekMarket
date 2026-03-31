from pathlib import Path

import cloudinary.uploader
from flask import current_app


def _file_size(image_file) -> int:
    stream = getattr(image_file, "stream", None)
    if stream and hasattr(stream, "seek") and hasattr(stream, "tell"):
        current_position = stream.tell()
        stream.seek(0, 2)
        size = stream.tell()
        stream.seek(current_position)
        return size
    content_length = getattr(image_file, "content_length", None)
    return int(content_length or 0)


def _validate_image_file(image_file) -> None:
    content_type = (getattr(image_file, "content_type", None) or "").lower()
    if content_type and not content_type.startswith("image/"):
        raise ValueError(f"Unsupported file type: {content_type}")

    allowed_extensions = set(current_app.config.get("IMAGE_UPLOAD_ALLOWED_EXTENSIONS") or [])
    suffix = Path(getattr(image_file, "filename", "")).suffix.lower()
    if suffix and allowed_extensions and suffix not in allowed_extensions:
        raise ValueError(f"Unsupported image extension: {suffix}")

    max_bytes = int(current_app.config.get("IMAGE_UPLOAD_MAX_BYTES") or 0)
    if max_bytes and _file_size(image_file) > max_bytes:
        raise ValueError("Image file is too large")


def upload_image_file(image_file, folder: str) -> str:
    _validate_image_file(image_file)

    upload_result = cloudinary.uploader.upload(
        image_file,
        folder=folder,
        overwrite=True,
        resource_type="image",
    )
    return upload_result["secure_url"]


def upload_image_files(image_files, folder: str) -> list[str]:
    urls = []
    max_files = int(current_app.config.get("IMAGE_UPLOAD_MAX_FILES") or 0)
    valid_files = [image_file for image_file in (image_files or []) if image_file and getattr(image_file, "filename", "")]
    if max_files and len(valid_files) > max_files:
        raise ValueError(f"You can upload up to {max_files} images at a time")
    for image_file in valid_files:
        urls.append(upload_image_file(image_file, folder))
    return urls
