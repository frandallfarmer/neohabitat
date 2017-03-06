from __future__ import print_function

import argparse
import json
import os

from glob import glob

from region import Region


ARG_PARSER = argparse.ArgumentParser(
    description='Transforms RDL files into Neohabitat JSON region files.',
)
ARG_PARSER.add_argument(
    'rdl_files_or_dirs',
    metavar='FILES_OR_DIRS',
    nargs='+',
    help='files or directories to read',
)
ARG_PARSER.add_argument(
    '--mod_index',
    dest='mod_index',
    default='./mod_index.yml',
    help='location of the Mod translation index YAML',
)

ARG_PARSER.add_argument(
    '--output_dir',
    dest='output_dir',
    default='.',
    help='where to output Neohabitat JSON region files',
)


def convert_file(rdl_file, output_dir):
  print(' - Converting RDL file: {0}'.format(rdl_file))
  new_region = Region.from_rdl_file(rdl_file)
  output_filename = os.path.join(output_dir,
    os.path.basename(rdl_file).replace('rdl', 'json'))
  print(' - Successfully parsed RDL file {0}, outputting to {1}'.format(rdl_file,
      output_filename))
  with open(output_filename, 'w') as output_file:
    output_file.write(json.dumps(new_region, indent=2))
  print(' - Successfully converted RDL file {0}!'.format(rdl_file))


def convert_files_in_dir(input_dir, output_dir):
  for rdl_file in glob(os.path.join(input_dir, '*.rdl')):
    convert_file(rdl_file, output_dir)


if __name__ in '__main__':
  args = ARG_PARSER.parse_args()
  for file_or_dir in args.rdl_files_or_dirs:
    if os.path.isdir(file_or_dir):
      convert_files_in_dir(file_or_dir, args.output_dir)
    else:
      convert_file(file_or_dir, args.output_dir)
