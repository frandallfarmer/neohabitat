package org.made.neohabitat;

/**
 * If a Habitat mod implements this interface, it indicates that it can
 * be copied.
 */
public interface Copyable {
    HabitatMod copyThisMod();
}
