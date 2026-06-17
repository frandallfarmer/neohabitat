// parse beta.mud
export const removeComments = (text) => {
    let newText = []
    let i = 0
    while (i < text.length) {
        let iLim = text.indexOf("/*", i)
        let iNext
        if (iLim < 0) {
            iLim = text.length
            iNext = iLim
        } else {
            const iCommentEnd = text.indexOf("*/", iLim + 2)
            if (iCommentEnd > 0) {
                iNext = iCommentEnd + 2
            } else {
                throw new Error(`Comment started at ${iLim} has no end`)
            }
        }
        newText.push(text.slice(i, iLim))
        i = iNext
    }
    return newText.join("")
}

const splitLine = (line) => {
    const tokens = line.trim().split(/\s+/)
    return (tokens.length == 1 && tokens[0] == '') ? [] : tokens
}

const reString = /^"(.*)"$/
const parseResourceLine = (line, dict) => {
    const tokens = splitLine(line)
    if (tokens.length == 1 && tokens[0] == "}") {
        return false
    } else if (tokens.length == 0) {
        return true
    } else if (tokens.length == 1 || !tokens[0].endsWith(":") || !tokens[1].match(reString)) {
        throw new Error(`Expected 'key: "value"' but got '${line}'`)
    } else {
        const key = tokens[0].slice(0, -1)
        const value = { filename: tokens[1].match(reString)[1] }
        if (tokens.length > 2) {
            value.arguments = tokens.slice(2).map((v) => parseInt(v)) // would be nice to know what these mean
        }
        dict[key] = value
        return true
    }
}

const parseClassLine = (line, cls) => {
    const tokens = splitLine(line)
    if (tokens.length == 1 && tokens[0] == "}") {
        return false
    } else if (tokens.length == 0) {
        return true
    } else if (tokens.length == 1) {
        throw new Error(`Expected "resourcetype reference" but got ${line}`)
    } else {
        const resourceType = tokens[0]
        if (!cls[resourceType]) {
            cls[resourceType] = []
        }
        const array = cls[resourceType]
        if (resourceType == "byte" && tokens.length == 2) {
            array.push(parseInt(tokens[1]))
        } else if (tokens.length == 2) {
            array.push({ id: tokens[1] })
        } else {
            array.push({ id: tokens[1], arguments: tokens.slice(2).map((v) => parseInt(v)) })
        }
        return true
    }
}

const parseStructure = (lines, iline, struct, parser) => {
    while (parser(lines[iline], struct)) {
        iline ++
    }
    return iline
}

const parseMud = (lines) => {
    const mud = {"class": {}}
    for (let iline = 0; iline < lines.length; iline ++) {
        const tokens = splitLine(lines[iline])
        if (tokens.length == 2 && tokens[1] == "{") {
            const mapping = {}
            iline = parseStructure(lines, iline + 1, mapping, parseResourceLine)
            mud[tokens[0]] = mapping
        } else if (tokens.length == 4 && tokens[0] == "class" && tokens[3] == "{") {
            const cls = { id: parseInt(tokens[2]) }
            iline = parseStructure(lines, iline + 1, cls, parseClassLine)
            mud.class[tokens[1]] = cls
        } else if (tokens.length != 0) {
            throw new Error(`Expected "resourcetype {" but got ${lines[iline]}`)
        }
    }
    return mud
}

export const parse = (text) => {
    return parseMud(removeComments(text).split("\n"))
}
