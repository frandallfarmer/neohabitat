import parser


parser.region_start.parseString('@region $ back4t_20 {')
parser.region_param.parseString('    north: back4t_30.l;')

parser.mod.parseString('        @ground { x:0; y:4; or:204; style:1; }')

multiline_mod = '''@door { x:64; y:32; or:220; style:1; 
  8:2;
  9:0;
  10:0;
}'''

parser.mod.parseString(multiline_mod)
