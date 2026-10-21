"""Compatibility entry point for the single uniform audio generator.

Writes only to a staging directory. See generate-uniform-audio.py --help.
"""
from pathlib import Path
import runpy

if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).with_name("generate-uniform-audio.py")), run_name="__main__")
