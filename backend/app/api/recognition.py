"""Classroom photo -> recognised students.

This endpoint performs **recognition only**. It deliberately never writes
attendance; use ``POST /api/attendance/process`` for that. Keeping the two
concerns apart is what makes recognition safe to call repeatedly.
"""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter, Depends, File, UploadFile

from app.api.dependencies import read_image_upload, require_face_model
from app.core.security import require_teacher
from app.database.repository import AttendanceRepository, get_repository
from app.schemas.common import ErrorResponse, ValidationErrorResponse
from app.schemas.recognition import RecognizedStudent, RecognitionResponse
from app.services.embedding_service import embedding_service
from app.services.matching_service import MatchingService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/recognition", tags=["recognition"])

_UNAUTHORIZED = {"model": ErrorResponse, "description": "`unauthorized` / `forbidden`."}
_ERROR = {"model": ErrorResponse, "description": "`invalid_image` or `no_face_detected`."}


@router.post(
    "/recognize",
    response_model=RecognitionResponse,
    summary="Recognise every student in a classroom photo",
    description=(
        "Detects every face in the uploaded image, generates a pretrained "
        "ArcFace embedding for each one, and searches the registered student "
        "embeddings with cosine similarity.\n\n"
        "A face is only reported as a student when the best similarity is "
        "**>= FACE_MATCH_THRESHOLD**; everything else is counted in "
        "`unknown_faces`.\n\n"
        "The `confidence` values are cosine similarities between embeddings - "
        "**not probabilities** that the face belongs to that student.\n\n"
        "Nothing is persisted by this endpoint."
    ),
    responses={
        200: {"description": "Recognition result (no attendance written)."},
        400: _ERROR,
        401: _UNAUTHORIZED,
        422: {"model": ValidationErrorResponse, "description": "`invalid_request`."},
    },
)
async def recognize_classroom(
    file: UploadFile = File(..., description="Classroom photo (JPEG/PNG)."),
    repository: AttendanceRepository = Depends(get_repository),
    actor: str = Depends(require_teacher),
    model_ready: None = Depends(require_face_model),
) -> RecognitionResponse:
    started = time.perf_counter()

    upload = await read_image_upload(file)
    faces = embedding_service.detect_faces(upload.image)

    matcher = MatchingService(repository)
    matches, unknown_faces, duplicates_removed = matcher.identify(faces)

    recognized = [
        RecognizedStudent(
            student_id=match.student.id,
            roll_number=match.student.roll_number,
            name=match.student.name,
            class_name=match.student.class_name,
            section=match.student.section,
            confidence=round(match.similarity, 4),
            face_bbox=[round(value, 1) for value in match.face.bbox],
        )
        for match in matches
        if match.student is not None
    ]

    elapsed_ms = (time.perf_counter() - started) * 1000
    logger.info(
        "Recognition by %s: total_faces=%d recognized=%d unknown=%d duplicates=%d "
        "threshold=%.2f elapsed_ms=%.1f",
        actor,
        len(faces),
        len(recognized),
        unknown_faces,
        duplicates_removed,
        matcher.threshold,
        elapsed_ms,
    )

    return RecognitionResponse(
        total_faces=len(faces),
        recognized=recognized,
        unknown_faces=unknown_faces,
        duplicates_removed=duplicates_removed,
        threshold=matcher.threshold,
        processing_time_ms=round(elapsed_ms, 1),
    )
