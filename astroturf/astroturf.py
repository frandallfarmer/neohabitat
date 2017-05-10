from __future__ import print_function

import ipdb
import os
import re
import uuid


DOOR_CONNECTION_REGEX = re.compile(r'\((.*)\)')  
STRING_REGEX = re.compile(r'"(.*)"')
REGION_SPECIFIER_REGEX = re.compile(r'([a-z])=(\(.*\)|\d+)')


def _strip_quotes(value):
  if STRING_REGEX.match(value):
    return STRING_REGEX.findall(value)[0]
  else:
    return value


class AstroturfRegion(object):
  west_linenumber = 0
  north_linenumber = 0
  east_linenumber = 0
  south_linenumber = 0

  def __init__(self, astroturf, line_number, line):
    print(' - Reading line {}: {}'.format(line_number, line))
    self.astroturf = astroturf
    self.line_number = line_number
    region_specifier, region_args = line.split('/')
    self.args = map(lambda arg: _strip_quotes(arg), region_args.strip().split())
    self.door_connections = []
    self._parse_region_specifier(region_specifier)
    self.port_dir = ''
    self.town_dir = ''

    random_id = str(uuid.uuid4())[:4]
    if not self.args:
      self.region_ref = '{}.{}'.format(self.region_proto, random_id)
      self.region_name = '{} {}'.format(self.region_proto, random_id)
    elif len(self.args) == 1:
      self.region_ref = '{}.{}.{}'.format(self.args[0], self.region_proto, random_id)
      self.region_name = '{} {}'.format(self.args[0], self.region_proto)
    elif len(self.args) == 2:
      self.region_ref = '{}.{}'.format(self.args[0], self.args[1])
      self.region_name = '{} {}'.format(self.args[0], self.args[1])
    else:
      self.region_ref = '{}.{}.{}'.format(self.args[-2], self.region_proto, random_id)
      self.region_name = '{} {}'.format(self.args[-2], self.region_proto)
      self.port_dir = self.args[-1]

  def _get_region_context(self, linenum):
    return 'context-{}'.format(self.astroturf.regions[linenum - 1].region_ref)

  @property
  def output_filename(self):
    return '{}.json'.format(self.region_ref)

  @property
  def template_dict(self):
    template_dict = {
      'region_ref': self.region_ref,
      'region_name': self.region_name,
      'orientation': self.orientation,
      'west_connection': '',
      'north_connection': '',
      'east_connection': '',
      'south_connection': '',
      'town_dir': self.town_dir,
      'port_dir': self.port_dir,
      'nitty_bits': 3,
    }

    # Determines any arguments for templating purposes.
    for i in range(len(self.args)):
      key = 'arg_{}'.format(i)
      template_dict[key] = self.args[i]

    # Determines region and door connections.
    for i in range(len(self.door_connections)):
      key = 'door{}_connection'.format(i)
      template_dict[key] = self._get_region_context(self.door_connections[i])

    if self.west_linenumber != 0:
      template_dict['west_connection'] = self._get_region_context(self.west_linenumber)
    if self.north_linenumber != 0:
      template_dict['north_connection'] = self._get_region_context(self.north_linenumber)
    if self.east_linenumber != 0:
      template_dict['east_connection'] = self._get_region_context(self.east_linenumber)
    if self.south_linenumber != 0:
      template_dict['south_connection'] = self._get_region_context(self.south_linenumber)

    return template_dict

  def _parse_connection(self, direction, value):
    if DOOR_CONNECTION_REGEX.match(value):
      self.door_connections = map(lambda linenum: int(linenum),
          DOOR_CONNECTION_REGEX.findall(value)[0].split())
    else:
      if direction == 'w':
        self.west_linenumber = int(value)
      elif direction == 'n':
        self.north_linenumber = int(value)
      elif direction == 'e':
        self.east_linenumber = int(value)
      elif direction == 's':
        self.south_linenumber = int(value)

  def _parse_region_specifier(self, region_specifier):
    self.region_proto = region_specifier.strip().split()[0]
    for region_elem in REGION_SPECIFIER_REGEX.findall(region_specifier):
      elem_identifier, elem_value = region_elem
      if elem_identifier == 'r':
        self.orientation = int(elem_value.strip())
      elif elem_identifier in set(['w', 'n', 'e', 's']):
        self._parse_connection(elem_identifier, elem_value.strip())

  def write_templated_region(self):
    if self.region_proto not in self.astroturf.region_name_to_proto:
      print(
          ' ! No prototype named {}.json found for region {} on line {}, skipping'.format(
          self.region_proto, self.region_ref, self.line_number))
      return False

    output_location = os.path.join(self.astroturf.output_dir, self.output_filename)
    print(' - Writing region {} from line {} to: {}'.format(
        self.region_ref, self.line_number, output_location))
    region_prototype = self.astroturf.region_name_to_proto[self.region_proto]
    templated_region_contents = region_prototype % self.template_dict
    with open(output_location, 'w') as output_file:
      output_file.write(templated_region_contents)
    print(' - Successully wrote region {} from line {} to: {}'.format(
        self.region_ref, self.line_number, output_location))
    return True


class Astroturf(object):
  regions = []
  region_name_to_proto = {}

  def __init__(self,
      input_dir, output_dir, base_griddle_filename, region_proto_filenames):
    self.input_dir = input_dir
    self.output_dir = output_dir
    self.base_griddle_filename = base_griddle_filename
    self.region_proto_filenames = region_proto_filenames
    self._parse_base_griddle()
    self._parse_region_prototypes()

  def _parse_base_griddle(self):
    print(' - Reading base .i file at: {}'.format(self.base_griddle_filename))
    with open(self.base_griddle_filename, 'r') as base_griddle_file:
      line_num = 0
      total_lines = -1
      for griddle_line in base_griddle_file.readlines():
        if line_num == 0:
          total_lines = int(griddle_line.strip())
        else:
          self.regions.append(AstroturfRegion(self, line_num, griddle_line.strip()))
        line_num += 1

  def _parse_region_prototypes(self):
    for region_proto_filename in self.region_proto_filenames:
      region_proto_name = os.path.split(region_proto_filename)[-1].split('.json')[0]
      print(' - Reading region prototype file: {}'.format(region_proto_name))
      with open(region_proto_filename, 'r') as region_proto_file:
        self.region_name_to_proto[region_proto_name] = region_proto_file.read()

  def write_output_files(self):
    print(' - Outputting all templated regions...')
    os.makedirs(self.output_dir)

    failures = []
    for region in self.regions:
      success = region.write_templated_region()
      if not success:
        failures.append(region)

    if not failures:
      print(' - Successfully outputted all templated regions to: {}'.format(
          self.output_dir))
      return True
    else:
      print(' ! Failures encountered during the templating of the following regions:')
      for failed_region in failures:
        print('   + {}, region_proto: {}, line_number: {}'.format(
            failed_region.region_ref, failed_region.region_proto,
            failed_region.line_number))
      return False
