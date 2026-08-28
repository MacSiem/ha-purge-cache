"""Regression checks for measured/unavailable purge statistics."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "ha-purge-cache.js").read_text(encoding="utf-8")


class AccuracyTests(unittest.TestCase):
    def test_tool_count_is_not_fabricated_or_derived_from_document_scan(self) -> None:
        self.assertNotIn("document.querySelectorAll('[class*=\"ha-\"]')", SOURCE)
        self.assertNotIn("Math.max(window.customCards?.length || 0, 1)", SOURCE)
        self.assertIn("stats.toolScripts = { count: null, unavailable: true }", SOURCE)
        self.assertIn("Number.isInteger(s.toolScripts.count)", SOURCE)


if __name__ == "__main__":
    unittest.main()
