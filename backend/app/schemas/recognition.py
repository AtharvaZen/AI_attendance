from __future__ import annotations

from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class RecognizedStudent(BaseModel):
    """A detected face that was matched to a registered student."""

    student_id: int
    roll_number: str
    name: str
    class_name: str
    section: str
    confidence: float = Field(
        description=(
            "Cosine similarity between the detected face embedding and the "
            "student's registered embeddings, in [0, 1]. This is a "
            "**confidence/similarity score, NOT a probability** that the face "
            "belongs to this student."
        )
    )
    face_bbox: list[float] = Field(
        description="Bounding box `[x1, y1, x2, y2]` of the matched face in the uploaded image."
    )


class RecognitionResponse(BaseModel):
    """Result of a pure recognition pass - nothing is written to the database."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "total_faces": 30,
                "recognized": [
                    {
                        "student_id": 101,
                        "roll_number": "101",
                        "name": "Rahul Sharma",
                        "class_name": "8",
                        "section": "A",
                        "confidence": 0.93,
                        "face_bbox": [120.0, 88.0, 210.0, 205.0],
                    }
                ],
                "unknown_faces": 2,
                "duplicates_removed": 0,
                "threshold": 0.45,
                "processing_time_ms": 812.4,
            }
        }
    )

    total_faces: int = Field(description="Number of usable faces detected in the image.")
    recognized: list[RecognizedStudent]
    unknown_faces: int = Field(description="Detected faces that matched no student above the threshold.")
    duplicates_removed: int = Field(
        default=0,
        description="Extra appearances of a student who was already recognised in this image.",
    )
    threshold: float = Field(description="Cosine-similarity threshold that was applied.")
    processing_time_ms: float
