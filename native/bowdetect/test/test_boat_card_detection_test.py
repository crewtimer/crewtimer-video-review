#!/usr/bin/env python3
"""End-to-end regression tests for boat, card, and number detection."""

from __future__ import annotations

import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent.parent
PROGRAM = PROJECT_DIR / "scripts" / "test_boat_card_detection.py"
NUMBER_PATTERN = re.compile(r"Recognized bow number '([^']+)'")


class BowDetectionTests(unittest.TestCase):
    def analyze(self, image_name: str, *extra_args: str) -> str:
        with tempfile.TemporaryDirectory() as output_dir:
            result = subprocess.run(
                [
                    sys.executable,
                    str(PROGRAM),
                    str(PROJECT_DIR / "images" / image_name),
                    "--boat-confidence",
                    "0.30",
                    "--output-dir",
                    output_dir,
                    *extra_args,
                ],
                check=True,
                capture_output=True,
                text=True,
            )
        return result.stdout

    def recognize(self, image_name: str) -> list[str]:
        return NUMBER_PATTERN.findall(self.analyze(image_name))

    def test_kayak_5(self) -> None:
        self.assertEqual(self.recognize("kayak5.png"), ["5"])

    def test_kayak_7(self) -> None:
        self.assertEqual(self.recognize("kayak7.png"), ["7"])

    def test_kayak_2(self) -> None:
        self.assertEqual(self.recognize("kayak2.png"), ["2"])

    def test_kayak_79(self) -> None:
        self.assertEqual(self.recognize("kayak79.png"), ["79"])

    def test_kayaks_4_and_3(self) -> None:
        self.assertCountEqual(self.recognize("kayak4-3.png"), ["4", "3"])

    def test_kayak_17(self) -> None:
        self.assertEqual(self.recognize("kayak17.png"), ["17"])

    def test_no_card_or_bow(self) -> None:
        output = self.analyze(
            "no-card-or-bow.png",
            "--number-model",
            str(PROJECT_DIR / "bow_crnn_numeric.onnx"),
        )
        self.assertEqual(NUMBER_PATTERN.findall(output), [])
        self.assertIn("Detected 0 bow card(s)", output)


if __name__ == "__main__":
    unittest.main()
