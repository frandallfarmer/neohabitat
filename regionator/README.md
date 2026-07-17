# regionator — region tooling for NeoHabitat

Python tools for building NeoHabitat regions from **RDL** ("Riddle") files —
the human-writable region description language descended from the original
Habitat production tooling — and for parsing the original Habitat world
database.

## RDL → NeoHabitat JSON

`app.py` compiles `.rdl` files into the JSON region documents the NeoHabitat
server loads (the same format as [`db/`](../db)):

```sh
python app.py Downtown_4c.rdl                 # emit Downtown_4c.json here
python app.py --output_dir out/ some_dir/     # convert every .rdl in a dir
```

An RDL region is a nested declaration of the region, its neighbors and
orientation, and its object tree (position, orientation byte, style,
container contents):

```
@region $ Downtown_4c {
    north: Downtown_4d.l;
    region_orientation: FACE_SOUTH;
    [
        @wall   { x:0; y:1; or:172; style:6; }
        @ground { x:0; y:4; or:204; style:1; }
        ...
    ]
}
```

Class/field translation is driven by `mod_index.yml` (with `mod_defaults.yml`
and `mod_renames.yml`); sample `.rdl` files sit alongside the scripts.

## Parsing the original 1980s world database

`parse_region_db.py` and `parse_object_db.py` decode the `MC_region` /
`MC_object` databases from the recovered Habitat **Stratus backup** into
faithful, uninterpreted JSON — the raw material the restored world was
rebuilt from. Each script's docstring documents the format knowledge (and
remaining unknowns).

## See also

- [The Inspector's region editor](https://frandallfarmer.github.io/neohabitat-doc/inspector/) —
  a graphical way to build a region for import.
- [docs/experiments.md](../docs/experiments.md) — the rest of the tooling family.
