// adapted from populateModels.js in neohabitat

const replacements = [
    [/UP/g, '"|"'],
    [/DOWN/g, '"}"'],
    [/LEFT/g, '"~"'],
    [/RIGHT/g, '"\u007f"'],
    [/SPACE/g, '" "'],
    [/WEST/g, '0'],
    [/SOUTH/g, '1'],
    [/EAST/g, '2'],
    [/NORTH/g, '3']
];

export const joinReplacements = {
    UP: '|',
    DOWN: '}',
    LEFT: '~',
    RIGHT: '\u007f',
    SPACE: ' ',
    WEST: '0',
    SOUTH: '1',
    EAST: '2',
    NORTH: '3'
};

const replacementJoinRegex = /((([A-Z]+\s?\+\s?)+)([A-Z]+\s?)+)/;
const stringJoinRegex = /(("([^"]|\\")*"\s*\+\s*)+"([^"]|\\")*")/g;

function templateStringJoins(data) {
    if (data.search(/\+/) != -1) {
        return data.replace(/(\n)/g, '').replace(stringJoinRegex,
            function(origText, offset, string) {
                var replacementText = [];
                var splitText = origText.split('+');
                for (var textLineId in splitText) {
                    var trimTextLine = splitText[textLineId].trim();
                    var quotesRemoved = trimTextLine.replace(/(^")|("$)/g, '');
                    replacementText.push(quotesRemoved);
                }
                return `"${replacementText.join('')}"`
            }
        );
    }
    return data;
}

function templateConstantJoins(data) {
    return data.replace(replacementJoinRegex, function(origText, offset, string) {
        var replacementText = [];
        var splitText = origText.split('+');
        for (var habConstId in splitText) {
            var trimHabConst = splitText[habConstId].trim();
            if (trimHabConst in joinReplacements) {
                replacementText.push(joinReplacements[trimHabConst]);
            }
        }
        return `"${replacementText.join('')}"`
    });
}

function templateHabitatObject(data) {
    try {
        // try parsing the string - if it's already valid JSON, there's no need to run the preprocessing logic
        JSON.parse(data)
        return data
    } catch (e) {
        var templated = templateConstantJoins(data);
        for (var replacementId in replacements) {
            var replacement = replacements[replacementId];
            var regex = replacement[0];
            var replacementText = replacement[1];
            templated = templated.replace(regex, replacementText);
        }
        return templateStringJoins(templated);    
    }
}

export function parseHabitatObject(data) {
    console.log(templateHabitatObject(data))
    return JSON.parse(templateHabitatObject(data))
}

export function parseHabitatRegion(data) {
    const region = parseHabitatObject(data)
    if (!Array.isArray(region) || region.length == 0) {
        throw new Error(`Not valid Habitat region JSON`)
    }
    return region.map(obj => {
        if (obj && obj.mods && obj.mods.length > 0) {
            const mod = obj.mods[0]
            mod.x = mod.x ?? 0
            mod.y = mod.y ?? 0
            mod.orientation = mod.orientation ?? 0
            mod.style = mod.style ?? 0
            mod.gr_state = mod.gr_state ?? 0
        }
        return obj
    })
}

export function colorsFromOrientation(orientation) {
    const colorVal = (orientation & 0x78) >> 3
    if (orientation & 0x80) {
        return { wildcard: colorVal }
    } else {
        return { pattern: colorVal }
    }
}

const javaTypeOverrides = {
    Teleport: "class_teleport_booth",
    "Windup_toy": "class_wind_up_toy"
}

export const javaTypeToMuddleClass = (type) => {
    return javaTypeOverrides[type] ?? `class_${type.toLowerCase()}`
}

