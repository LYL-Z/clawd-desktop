"""Regression checks for the measurement correction; masks are not pet artwork."""
import importlib.util
from pathlib import Path
import unittest
from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location('leg_classifier', Path(__file__).resolve().parents[1] / 'scripts/classify-exterior-leg-gaps.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

class ExteriorLegGaps(unittest.TestCase):
    def mask(self):
        alpha = Image.new('L',(112,120),0)
        draw = ImageDraw.Draw(alpha)
        draw.rectangle((10,10,91,79),fill=255)
        for left in (10,33,56,79): draw.rectangle((left,80,left+12,99),fill=255)
        return alpha

    def proof(self,alpha,y):
        return module.leg_slot_proof(alpha,y,module.bottom_exterior(alpha))

    def test_three_open_slots_between_four_feet_are_classified(self):
        self.assertIsNotNone(self.proof(self.mask(),81))

    def test_enclosed_low_torso_holes_are_never_excluded(self):
        alpha = self.mask(); draw = ImageDraw.Draw(alpha)
        for left,right in ((23,32),(46,55),(69,78)): draw.rectangle((left,73,right,76),fill=0)
        self.assertIsNone(self.proof(alpha,74))

    def test_mid_body_seam_with_four_runs_is_retained(self):
        alpha = self.mask(); draw = ImageDraw.Draw(alpha)
        for left,right in ((23,32),(46,55),(69,78)): draw.rectangle((left,50,right,53),fill=0)
        self.assertIsNone(self.proof(alpha,51))

    def test_arbitrary_lower_two_part_gap_is_retained(self):
        alpha = self.mask(); ImageDraw.Draw(alpha).rectangle((44,71,57,79),fill=0)
        self.assertIsNone(self.proof(alpha,74))

if __name__ == '__main__': unittest.main()
