
export let db = { elements: null, ids: null }



export async function getElement(id) {

    const element = await db.elements?.find({ id: parseInt(id) }).sort({ "meta.created": -1 }).limit(1).toArray();
    return element ? element[0] : null
}

export async function getSearch(jeu) {
    let element = await db.elements.aggregate([{ "$match":  { "meta.jeu": { "$eq": jeu } } },{ "$sort": { "meta.created": 1 } }, { $group: { _id: "$id", "doc": { "$last": "$$ROOT" } } }]).toArray();
    element = element.map((e) => { let r = e.doc.meta; r.id = e.doc?.id; r.name = e.doc.content?.name; return r })
    element = element.filter((e) => e.status !== "DELETED")
    element = element.map(e => { return { jeu: e.jeu, type: e.type, id: e.id, name: e.name } })
    return element
}




export async function getListElement(jeu, type) {
    let element = await db.elements.aggregate([{ "$match": { "meta.type": { "$eq": type } , "meta.jeu": { "$eq": jeu } } }, { "$sort": { "meta.created": 1 } }, { $group: { _id: "$id", "doc": { "$last": "$$ROOT" } } }]).toArray();
    element = element.map(e => e.doc)
    element = element.filter(e => e.meta.status !== "DELETED")
    element=element.sort((a,b)=>a.content.name.localeCompare(b.content.name))
    return element
}


function purgeLien(content) {
    if (!content) {
        return
    }
    else if (content?.__link) {
        delete content.content
    }
    else if (typeof content.map === "function") {
        content.map((e) => purgeLien(e))
    }
    else if (typeof content === "object") {
        Object.entries(content).map(e => purgeLien(e[1]))
    }
}

export async function buildElement(content, jeu, type, id, u, status) {
    let nid
    if (id === 0)
        nid = await nextId("element")
    else
        nid = id

    purgeLien(content)

    let data = { id: nid, content: content, meta: {} }

    data.meta.author = u.id
    data.meta.jeu = jeu
    data.meta.type = type
    data.meta.created = Date.now()
    data.meta.status = status

    return data
}

export async function save(data) {

    await db.elements.insertOne(data)

    return data.id
}


async function nextId(id) {
    const val = await db.ids?.findOne({ 'id': id })
    if (!val) {
        await db.ids?.insertOne({ 'id': id, 'val': 1 });
        return 1
    }
    else {
        await db.ids?.updateOne({ 'id': id }, { '$inc': { 'val': 1 } })
        return val.val + 1
    }
}

export async function getStat(jeu) {
    const result = await db.elements.aggregate([
        {
            $match: {
                "meta.jeu": jeu
            }
        },

        // Le dernier état de chaque élément en premier
        {
            $sort: {
                "id": 1,
                "meta.date": -1,
                "_id": -1
            }
        },

        // On garde le dernier état de chaque élément
        {
            $group: {
                _id: "$id",
                latest: { $first: "$$ROOT" }
            }
        },

        // On ignore les éléments dont le dernier état est DELETED
        {
            $match: {
                "latest.meta.status": {
                    $ne: "DELETED"
                }
            }
        },

        // Comptage directement par type
        {
            $group: {
                _id: "$latest.meta.type",
                count: { $sum: 1 }
            }
        }
    ]).toArray();

    return Object.fromEntries(
        result.map(({ _id, count }) => [_id, count])
    );
}


