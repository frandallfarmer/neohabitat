from pyparsing import (
    alphas,
    alphanums,
    LineEnd,
    LineStart,
    nums,
    Optional,
    Word,
    ZeroOrMore,
)


region_identifier = Word(alphanums + '_')

region_start = (LineStart() + '@region $ ' +
  region_identifier.setResultsName('region_identifier') +
  '{' + LineEnd())
region_end = LineStart() + '}' + LineEnd()

region_param_valid = Word(alphanums + '_.')
region_param = (region_param_valid + ': ' + region_param_valid + ';' + LineEnd())

mod_identifier = Word(alphas.upper() + alphas.lower() + '_')
mod_param_name = Word(' ' + alphas.upper() + alphas.lower() + '_')

mods_start_line = '[' + LineEnd()
mods_end_line = ']' + LineEnd()

mod_param = mod_param_name + ':' + Word(nums) + ";"
mod_param_additional_line = Word(nums) + ':' + Word(nums) + ';'

# pyparsing is not a recursive descent parser, so this ugly little hack takes advantage
# of the fact that there are no more than three layers of nesting in any RDL file.
inner_mod_3 = ('@' + mod_identifier.setResultsName('inner_mod_3_identifier') + '{' +
  ZeroOrMore(mod_param).setResultsName('inner_mod_3_params') + 
  ZeroOrMore(mod_param_additional_line).setResultsName('inner_mod_3_params_additional') +
  '}')

inner_mod_2 = ('@' + mod_identifier.setResultsName('inner_mod_2_identifier') + '{' +
  ZeroOrMore(mod_param).setResultsName('inner_mod_2_params') + 
  ZeroOrMore(mod_param_additional_line).setResultsName('inner_mod_2_params_additional') +
  Optional(mods_start_line + ZeroOrMore(inner_mod_3('inner_mod_3')) + mods_end_line) +
  '}')

inner_mod_1 = ('@' + mod_identifier.setResultsName('inner_mod_1_identifier') + '{' +
  ZeroOrMore(mod_param).setResultsName('inner_mod_1_params') + 
  ZeroOrMore(mod_param_additional_line).setResultsName('inner_mod_1_params_additional') +
  Optional(mods_start_line + ZeroOrMore(inner_mod_2('inner_mod_2')) + mods_end_line) +
  '}')

mod = ('@' + mod_identifier.setResultsName('mod_identifier') + '{' +
  ZeroOrMore(mod_param).setResultsName('mod_params') + 
  ZeroOrMore(mod_param_additional_line).setResultsName('mod_params_additional') +
  Optional(mods_start_line + ZeroOrMore(inner_mod_1('inner_mod_1')) + mods_end_line) +
  '}')

mods = mods_start_line + ZeroOrMore(mod('mod')) + mods_end_line

region = (region_start + ZeroOrMore(region_param).setResultsName('region_params') +
  ZeroOrMore(mods).setResultsName('mods') + region_end)
