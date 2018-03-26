'''
Parse the MC_region database from the Habitat Stratus backup.

Usage: parse_region_db.py MC_region output.json

The intention is for this output to represent the original data, but not
interpret it in any way. For example, names are still padded with spaces
to a fixed size.

We have reasonable assurance that these fields are correct. We have compared
them to Griddle (.gri) and Riddle (.rdl) files, which were created at
various points in Habitat's evolution. We've also verified the regions
match screenshots from back in the day and that the relationships to each
other make sense.

For the nitty_bits (flags) field, we include both the original integer
value of this field as well as individual named flags as created by
extract_flags().

There is some unknown data left in the final padding field that we don't
decode yet, but it's only present for 7 regions and appears to be a single
integer, perhaps a region ID reference. The combinations of region ID and
value for this unknown field are:

1160:  00 00 28 75
9112:  00 00 1f ac
10354: 00 00 23 98
10370: 00 00 13 a5
10372: 00 00 23 98
10382: 00 00 1f ac
10443: 00 00 1f ac
'''

import json, struct, sys

STRUCT_ITEMS = (
    'ident',
    'owner_id',
    'light_level',
    'depth',
    'east_neighbor',
    'west_neighbor',
    'north_neighbor',
    'south_neighbor',
    'class_group',
    'orientation',
    'entry_proc',
    'exit_proc',
    'east_exit_type',
    'west_exit_type',
    'north_exit_type',
    'south_exit_type',
    'nitty_bits',
    'name',
    'avatars',
    'to_town',
    'to_port',
)

FORMAT = '> 2i 2h 4i 8h I 20s 3b 33x'
assert struct.calcsize(FORMAT) == 104


def extract_flags(flags):
    '''
    Extract known region flags out of nitty_bits.

    There are two bits of nitty_bits we didn't find explained in the griddle
    file, so they aren't decoded here.

    * 0x02000000: this bit is very common, but is only set on Popustop regions.
    One theory is that this is related to the "turf" concept.
    * 0x00400000: this bit is present on only two regions, IDs 1010 and 10463.
    It is unknown what it's for.
    '''
    return {
        'east_restriction': bool(flags & (1 << 31)),
        'west_restriction': bool(flags & (1 << 30)),
        'north_restriction': bool(flags & (1 << 29)),
        'south_restriction': bool(flags & (1 << 28)),
        'weapons_free': bool(flags & (1 << 27)),
        'theft_free': bool(flags & (1 << 26)),
    }


def main():
    items = []
    with open(sys.argv[1]) as fp:
        while True:
            row = fp.read(struct.calcsize(FORMAT))
            if not row:
                break

            # Unpack all named fields into a dict
            data = dict(zip(STRUCT_ITEMS, struct.unpack(FORMAT, row)))

            # Unpack specific flags while preserving nitty_bits itself.
            data.update(extract_flags(data['nitty_bits']))

            # Filter out one room, which is the only one with a duplicate
            # ident. The room with the name "82 Mince St" duplicates room
            # ident 1134. The other one is named "Haunted Mansion" and has
            # other exits that aren't dupes, so we keep it.
            if data['ident'] == 10362 and \
                data['name'].strip() == '82 Mince St':
                continue

            items.append(data)

    with open(sys.argv[2], 'w') as fp:
        json.dump(items, fp, indent=2, sort_keys=True)

if __name__ == '__main__':
    main()
