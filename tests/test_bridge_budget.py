"""Adapter-to-browser byte budget regression. Fixtures only; no network."""
import json
from pathlib import Path
import re
import unittest

from bridge.server import ENDPOINTS, MAX_PROJECTS, MAX_DEPENDENCIES, StateAdapter


class BridgeBudgetTests(unittest.TestCase):
    def test_maximum_bounded_multilingual_inventory_fits_frontend_budget(self):
        root = Path(__file__).resolve().parents[1]
        model = (root / "game/model.js").read_text()
        match = re.search(r"const MAX_FEED_BYTES = ([0-9_ *]+);", model)
        self.assertIsNotNone(match, "Export one explicit finite frontend byte budget")
        budget = 1
        for factor in match.group(1).split("*"):
            budget *= int(factor.strip().replace("_", ""))
        self.assertEqual(budget, 1024 * 1024)
        self.assertRegex(model, r"return \{[^}]*MAX_FEED_BYTES[^}]*\}")
        self.assertIn("size > M.MAX_FEED_BYTES", (root / "game/dashboard.js").read_text())

        # Astral Unicode expands to two six-byte JSON escapes in the bridge's
        # ensure_ascii=True transport. All textual/array fields hit their limits.
        row = {"name": "\U0001f3ed" * 160, "stage": "\U0001f3ed" * 48,
               "status": "\U0001f3ed" * 64, "source_exists": False, "order": 1_000_000,
               "depends_on": [f"d{i:02d}" + "x" * 77 for i in range(MAX_DEPENDENCIES)]}
        registry = {"schema_version": 1, "components": [
            {**row, "id": f"p{i:03d}" + "y" * 76} for i in range(MAX_PROJECTS)]}
        raw_input = json.dumps(registry, ensure_ascii=False, separators=(",", ":")).encode()
        self.assertLessEqual(len(raw_input), ENDPOINTS["projects"].max_bytes)
        state = StateAdapter(True, lambda key: registry if key == "projects" else
                             {"services": []} if key == "health" else {}).snapshot()
        output = json.dumps(state, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode()
        self.assertEqual(len(state["projects"]), MAX_PROJECTS)
        self.assertGreater(len(output), 262144, "Fixture must reproduce the old 256 KiB rejection")
        self.assertLessEqual(len(output), budget)


if __name__ == "__main__":
    unittest.main()
