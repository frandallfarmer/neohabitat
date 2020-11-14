'''
Parse the MC_object database from the Habitat Stratus backup.

There are still lots of unknowns:

* Many objects have container 0x20202020. They appear to be unused, but it's
  unclear why.
* Some address strings have unprintable characters. It's unclear if this
  was intentional or garbage data.
* Matchbook (class 49): there are 3 objects of this type, but they appear
  to be overwritten or otherwise unused.
* When combined with MC_regions, we find lots of orphaned objects. This may
  be because of broken relationships. Some appear to be pockets of avatars.
'''

import json, struct, sys
from collections import OrderedDict

STRUCT_ITEMS = (
    'id',
    'class',
    'container',
    'contype',
    'x_pos',
    'y_pos',
    'style',
    'gr_state',
    'orientation',
    'gr_width',
    'nitty_bits',
    'prop_length',
    'property_data',
)

FORMAT = '> 3I 7H I 10x H 86s'
assert struct.calcsize(FORMAT) == 128

PARSERS = {
    2:   ('>HI', ['magic_type', 'magic_data']),
    129: ('>H', ['state']),
    6:   ('>HW', ['open_flags', 'key']),
    130: ('>H', ['open_flags']),
    10:  ('>HIH', ['current_page', 'text_id', 'last_page']),
    12:  ('>H', ['filled']),
    13:  ('>HW', ['open_flags', 'key']),
    131: ('>HH', ['width', 'length']),
    132: ('>xxxxxxi', ['connection']),
    158: ('>H', ['open_flags']),
    134: ('>H', ['open_flags']),
    135: ('>HW', ['open_flags', 'key']),
    136: ('>I', ['take']),
    137: ('>H', ['open_flags']),
    18:  ('>HW', ['open_flags', 'key']), # + whoput array
    20:  ('>H', ['live']),
    21:  ('>H', ['state']),
    22:  ('>HWIH', ['open_flags', 'key', 'owner', 'locked']),
    23:  ('>HWi', ['open_flags', 'key', 'connection']),
    25:  ('>HH', ['count', 'effect']),
    28:  ('>HI20s', ['state', 'take', 'address']),
    26:  ('>H', ['charge']),
    27:  ('>H', ['state']),
    29:  ('>H', ['mass']),
    30:  ('>H', ['on']),
    93:  ('>H', ['flat_type']),
    139: ('>H', ['on']),
    140: ('>I', ['take']),
    141: ('>H', ['live']),
    5:   ('>H', ['state']),
    32:  ('>HW', ['open_flags', 'key']),
    33:  ('>HI', ['magic_type', 'magic_data']),
    98:  ('>HWHHHHHHHHHHHH', ['open_flags', 'key', 'x_offset_1', 'y_offset_1',
        'x_offset_2', 'y_offset_2', 'x_offset_3', 'y_offset_3', 'x_offset_4',
        'y_offset_4', 'x_offset_5', 'y_offset_5', 'x_offset_6', 'y_offset_6']),
    35:  ('>H', ['pinpulled']),
    38:  ('>H', ['state']),
    88:  ('>HW', ['open_flags', 'key']),
    40:  ('>H', ['instant_what']),
    42:  ('>W', ['key_number']),
    43:  ('>H', ['is_magic']),
    45:  ('>HHxxxxH', ['lamp_state', 'wisher', 'live']),
    46:  ('>HI', ['magic_type', 'magic_data']),
    48:  ('>HI', ['mail_arrived', 'owner']),
    # XXX can't find valid example to decode varstring properly
    #49:  ('>84s', ['mtext']),
    52:  ('>H', ['on']),
    54:  ('>I', ['text_id']),
    96:  ('>HW', ['open_flags', 'key']),
    152: ('>HH', ['mass', 'picture']),
    58:  ('>H', ['mass']),
    55:  ('>HIH', ['current_page', 'text_id', 'last_page']),
    60:  ('>HI', ['magic_type', 'magic_data']),
    61:  ('>H', ['mass']),
    149: ('>HH', ['base', 'pattern']),
    150: ('>HW', ['open_flags', 'key']),
    63:  ('>H', ['on']),
    64:  ('>H', ['scan_type']),
    #56: short sign, handled below
    #57: sign, handled below
    95:  ('>H', ['charge']),
    70:  ('>HH', ['on', 'tape']),
    153: ('>HH', ['width', 'height']),
    92:  ('>HHHHHHHH', ['trapezoid_type', 'upper_left_x', 'upper_right_x',
        'lower_left_x', 'lower_right_x', 'height',
        'pattern_x_size','pattern_y_size']), # + pattern array
    97:  ('>HI', ['magic_type', 'magic_data']),
    155: ('>HW', ['open_flags', 'key']),
    74:  ('>HI20s', ['state', 'take', 'address']),
    75:  ('>H', ['event']),
    76:  ('>W', ['denom']),
    87:  ('>HHHHHH', ['trapezoid_type', 'upper_left_x', 'upper_right_x',
        'lower_left_x', 'lower_right_x', 'height']),
    85:  ('>HWHH', ['open_flags', 'key', 'item_price',
        'display_item']), # + prices array
    86:  ('>HW', ['open_flags', 'key']),
    80:  ('>HH', ['length', 'height', 'pattern']),
    82:  ('>H', ['wind_level']),
}


def decode_properties(buf, fmt, keys):
    '''
    Parse the properties from the given byte buffer, using the format string
    and names of keys for each item in the format string. Returns a dict
    of name/value pairs for all keys.
    '''
    fat_words = []

    # Handle fatwords, which are 16-bits stored as 00 xx 00 yy.
    if 'W' in fmt:
        # Hack: our fatword handling doesn't count repeated format strings
        idx = fmt.index('W')
        if fmt[:idx].isdigit():
            raise ValueError('cant handle format strings with numbers')

        base = 1 if not fmt[0].isalpha() else 0
        fmt_chars = []
        for i, c in enumerate(fmt):
            if c == 'W':
                c = 'I'
                fat_words.append(keys[i - base])
            fmt_chars.append(c)
        fmt = ''.join(fmt_chars)

    data = OrderedDict(zip(
        keys,
        struct.unpack(fmt, buf[:struct.calcsize(fmt)])))

    # Replace each fat word with its actual value
    for name in fat_words:
        data[name] = ((data[name] >> 8) & 0xff00) | (data[name] & 0xff)

    return data


def parse_array(buf, fmt, count):
    '''
    Unpack a number of same-sized items into an array
    '''
    items = []
    item_size = struct.calcsize(fmt)
    for i in range(count):
        items += struct.unpack(fmt, buf[i * item_size:(i + 1) * item_size])
    return items


def decode_text(buf):
    '''
    Decode a word-packed string (00 x 00 y ...), which is similar to a
    fatword but is a string instead of int.
    '''
    return [buf[i] for i in range(1, len(buf), 2)]


def parse_properties(cls, property_data):
    '''
    Decode basic properties and then class-specific ones
    '''
    data = OrderedDict()
    args = PARSERS.get(cls)
    if args:
        data.update(decode_properties(property_data, *args))
        remainder_off = struct.calcsize(args[0].replace('W', 'I'))

    # Special class decoders for those not fully handled above
    if cls == 56:
        # short sign
        data['text'] = decode_text(property_data[:10 * 2])
    elif cls == 57:
        # sign
        data['text'] = decode_text(property_data[:40 * 2])
    elif cls == 18:
        # countertop: whoput = 5 ints
        n = 5
        data['whoput'] = parse_array(
            property_data[remainder_off:remainder_off + n * 4],
            '>I',
            n)
    elif cls == 92:
        # super trapezoid: pattern = 32 halfwords
        n = 32
        data['pattern'] = parse_array(
            property_data[remainder_off:remainder_off + n * 4],
            '>H',
            n)
    elif cls == 85:
        # vendo front: prices = 10 halfwords
        n = 10
        data['prices'] = parse_array(
            property_data[remainder_off:remainder_off + n * 4],
            '>H',
            n)

    return data


def decode_row(row):
    '''
    Parse a single row and return a dict of the items
    '''
    data = OrderedDict(zip(STRUCT_ITEMS, struct.unpack(FORMAT, row)))
    data.update(parse_properties(data['class'], data['property_data']))

    # Debug-dump the Matchbook class 
    #if data['class'] == 49:
    #    print ' '.join('%02x' % ord(c) for c in row)
    #    print data

    # These fields tend to be all padding for many objects.
    # Maybe these were deleted or superseded?
    data['deleted'] = (data['container'] == 0x20202020 and
        data['contype'] == 0x2020)

    # Always remove the raw property bytes, which we've decoded
    del data['property_data']

    # Clear text data if it's unprintable
    if 'address' in data:
        if any(c >= 0x80 for c in data['address']):
            #print ' '.join('%02x' % ord(c) for c in row)
            #print data
            data['address'] = ''
        else:
            data['address'] = data['address'].decode('ascii')

    return data


def main():
    '''
    Read each row from database and then decode it, dumping output to JSON
    '''
    items = []
    with open(sys.argv[1], "rb") as fp:
        while True:
            row = fp.read(struct.calcsize(FORMAT))
            if not row:
                break
            items.append(decode_row(row))

    with open(sys.argv[2], 'w') as fp:
        json.dump(items, fp, indent=2)

if __name__ == '__main__':
    main()
