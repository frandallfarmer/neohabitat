from __future__ import print_function

import json
import os
import re
import string
import sys
import traceback
import uuid
import yaml


DOOR_CONNECTION_REGEX = re.compile(r'\((.*)\)')  
STRING_REGEX = re.compile(r'"(.*)"')
REGION_SPECIFIER_REGEX = re.compile(r'([a-z])=(\(.*\)|\d+)')

OCTAL_REGEX_STRING = r'(!ASTROESC!\d\d\d)'
OCTAL_REGEX = re.compile(OCTAL_REGEX_STRING)

HEX_REGEX_STRING = r'(!ASTROESC!x[0-9a-f][0-9a-f])'
HEX_REGEX = re.compile(HEX_REGEX_STRING)

CUSTOM_ESCAPE_REGEX_STRING = r'(!ASTROESC!.)'
CUSTOM_ESCAPE_REGEX = re.compile(CUSTOM_ESCAPE_REGEX_STRING)


CUSTOM_ESCAPES_TABLE = {}
with open('./custom_escapes_table.yml', 'r') as custom_escapes_table:
  CUSTOM_ESCAPES_TABLE = yaml.load(custom_escapes_table)


def _strip_quotes(value):
  if STRING_REGEX.match(value):
    return STRING_REGEX.findall(value)[0]
  else:
    return value


def _custom_escape_to_ascii(custom_escape):
  escape_char = custom_escape[10:11]
  if escape_char in CUSTOM_ESCAPES_TABLE:
    return int(CUSTOM_ESCAPES_TABLE[escape_char])
  else:
    # Handles \a-z or \A-Z cases.
    if escape_char in string.lowercase or escape_char in string.uppercase:
      return int(128 + string.lowercase.index(escape_char.lower()))


def _hex_escape_to_ascii(hex_escape):
  hex_text = hex_escape[11:]
  return int(hex_text, 16)


def _octal_escape_to_ascii(octal_escape):
  octal_text = octal_escape[10:]
  return int(octal_text, 8)


def _astroesc_text_to_ascii_int_list(text):
  range_to_replacement = []

  def _get_replacement(index):
    should_replace = False
    for replace_start, replace_end, replacement in range_to_replacement:
      if replace_start <= index < replace_end:
        if index == replace_start:
          return True, replacement
        else:
          return True, None
    return False, None

  for octal_match in OCTAL_REGEX.finditer(text):
    octal_replace_tuple = (
      octal_match.pos,
      octal_match.end(),
      _octal_escape_to_ascii(octal_match.groups()[0]),
    )
    range_to_replacement.append(octal_replace_tuple)

  for hex_match in HEX_REGEX.finditer(text):
    hex_replace_tuple = (
      hex_match.pos,
      hex_match.end(),
      _hex_escape_to_ascii(hex_match.groups()[0]),
    )
    range_to_replacement.append(hex_replace_tuple)

  for custom_match in CUSTOM_ESCAPE_REGEX.finditer(text):
    custom_replace_tuple = (
      custom_match.pos,
      custom_match.end(),
      _custom_escape_to_ascii(custom_match.groups()[0]),
    )
    range_to_replacement.append(custom_replace_tuple)

  # Patches together an ASCII int array with all escaped replacements.
  ascii_string = []
  for i in range(len(text)):
    should_replace, replacement = _get_replacement(i)
    if should_replace:
      if replacement is not None:
        ascii_string.append(replacement)
    else:
      ascii_string.append(ord(text[i]))

  return ascii_string


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

    random_id = str(uuid.uuid4())[:8]
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
      'is_turf': 'turf' in self.region_proto,
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
      key = 'arg_{}'.format(i+1)
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
    
    region_contents = (region_prototype % self.template_dict).replace('\\', '!ASTROESC!')

    try:
      # Tests whether the JSON parses after templating.
      region_json = json.loads(region_contents)
      ascii_converted_region = []

      # If it does, converts all 'text' fields to 'ascii' equivalents.
      for elko_obj in region_json:
        ascii_converted_mods = []
        for habitat_mod in elko_obj['mods']:
          if 'text' in habitat_mod:
            habitat_mod['ascii'] = _astroesc_text_to_ascii_int_list(habitat_mod['text'])
            del habitat_mod['text']
          ascii_converted_mods.append(habitat_mod)
        elko_obj['mods'] = ascii_converted_mods
        ascii_converted_region.append(elko_obj)

      # Finally, writes out the fully-templated and escaped region.
      with open(output_location, 'w') as output_file:
        output_file.write(json.dumps(ascii_converted_region, indent=2))

      print(' - Successully wrote region {} from line {} to: {}'.format(
          self.region_ref, self.line_number, output_location))
      return True
    except Exception:
      print(' ! JSON parse check for region {} from line {} failed; skipping:'.format(
        self.region_ref, self.line_number))
      traceback.print_exc()


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
