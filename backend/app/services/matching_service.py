"""Cosine-similarity matching of detected faces against registered embeddings.

Read this before interpreting any number this module produces
----------------------------------------------------------------
The returned value is a **cosine similarity between two face embeddings**
produced by a pretrained ArcFace model. It is **NOT a probability** that the
detected face belongs to the matched student.

``0.93`` similarity does not mean "93 % likely to be this student". Similarity
scores are not calibrated probabilities, and the same score means different
things for different cameras, lighting and populations. Call it a
*confidence/similarity score* in any UI or report.

The accept/reject decision is a single configurable threshold
(``FACE_MATCH_THRESHOLD``) that must be tuned on your own data (see
``scripts/evaluate_recognition.py``).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.core.config import settings
from app.database.records import StudentRecord
from app.database.repository import AttendanceRepository
from app.services.face_service import DetectedFace

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class FaceMatch:
    """The outcome of matching one detected face."""

    face: DetectedFace
    student: StudentRecord | None
    similarity: float
    #: Best similarity belonging to a *different* student (identification margin).
    runner_up_similarity: float | None
    #: True when ``similarity >= threshold`` and a student was resolved.
    accepted: bool

    @property
    def margin(self) -> float | None:
        if self.runner_up_similarity is None:
            return None
        return self.similarity - self.runner_up_similarity


class MatchingService:
    """Nearest-neighbour matching with a configurable similarity threshold."""

    def __init__(
        self,
        repository: AttendanceRepository,
        threshold: float | None = None,
        class_name: str | None = None,
        section: str | None = None,
    ) -> None:
        self._repository = repository
        self._threshold = (
            settings.face_match_threshold if threshold is None else threshold
        )
        # When set, candidates are restricted to that class *inside* the search,
        # so a face can never be matched against another class's students.
        self._class_name = class_name
        self._section = section

    @property
    def threshold(self) -> float:
        return self._threshold

    def match_face(self, face: DetectedFace) -> FaceMatch:
        """Find the closest registered student for a single detected face."""
        if face.embedding is None:
            return FaceMatch(face, None, 0.0, None, False)

        candidates = self._repository.search_similar(
            face.embedding,
            limit=settings.recognition_candidates,
            class_name=self._class_name,
            section=self._section,
        )
        if not candidates:
            return FaceMatch(face, None, 0.0, None, False)

        best_face, best_similarity = candidates[0]
        # The runner-up must come from a different student to be meaningful.
        runner_up = next(
            (
                similarity
                for candidate, similarity in candidates[1:]
                if candidate.student_id != best_face.student_id
            ),
            None,
        )

        student = self._repository.get_student(best_face.student_id)
        accepted = student is not None and best_similarity >= self._threshold

        logger.info(
            "Face match: similarity=%.4f threshold=%.2f margin=%s accepted=%s student_id=%s",
            best_similarity,
            self._threshold,
            "n/a" if runner_up is None else f"{best_similarity - runner_up:.4f}",
            accepted,
            student.id if student else None,
        )
        return FaceMatch(face, student if accepted else None, best_similarity, runner_up, accepted)

    def match_faces(self, faces: list[DetectedFace]) -> list[FaceMatch]:
        return [self.match_face(face) for face in faces]

    def identify(
        self, faces: list[DetectedFace]
    ) -> tuple[list[FaceMatch], int, int]:
        """Split matches into ``(accepted_matches, unknown_count, duplicate_count)``.

        A student detected more than once keeps only their best-scoring
        occurrence; the extra occurrences are counted as duplicates.
        """
        matches = self.match_faces(faces)

        best_by_student: dict[int, FaceMatch] = {}
        unknown = 0
        duplicates = 0
        for match in matches:
            if not match.accepted or match.student is None:
                unknown += 1
                continue
            current = best_by_student.get(match.student.id)
            if current is None:
                best_by_student[match.student.id] = match
            elif match.similarity > current.similarity:
                best_by_student[match.student.id] = match
                duplicates += 1
            else:
                duplicates += 1

        ordered = sorted(best_by_student.values(), key=lambda m: m.similarity, reverse=True)
        return ordered, unknown, duplicates
