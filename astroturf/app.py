from __future__ import print_function

import argparse
import os
import sys

from glob import glob

from astroturf import Astroturf


ARG_PARSER = argparse.ArgumentParser(
    description='Renders templated regions based upon Griddle input files',
)
ARG_PARSER.add_argument(
    '--input_dir',
    dest='input_dir',
    default='.',
    help='where the base Griddle and JSON template region files can be found',
)
ARG_PARSER.add_argument(
    '--output_dir',
    dest='output_dir',
    default='astroturf',
    help='where to output Neohabitat JSON region files',
)


def convert_files_in_dir(input_dir, output_dir):
  griddle_base_files = glob(os.path.join(input_dir, '*.i'))
  if not griddle_base_files:
    print(' ! No .i file found in input dir, bailing...')
    sys.exit(-1)
  griddle_base_file = griddle_base_files[0]
  region_proto_files = glob(os.path.join(input_dir, '*.json'))
  if not region_proto_files:
    print(' ! No .json files found in input dir, bailing...')
    sys.exit(-2)
  astroturf = Astroturf(input_dir, output_dir, griddle_base_file, region_proto_files)
  success = astroturf.write_output_files()
  if not success:
    print(' ! Failed to convert all regions.')
    sys.exit(-3)


if __name__ in '__main__':
  args = ARG_PARSER.parse_args()
  convert_files_in_dir(args.input_dir, args.output_dir)
