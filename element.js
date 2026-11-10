import { ObjectId } from "mongodb";

export let db = { elements: null, ids: null }



export async function getElement(id) {

    return await db.elements.findOne(
        {
            id: parseInt(id)
        },
        {
            sort: {
                "meta.created": -1
            }
        }
    );
}


// Ce à quoi un élément est lié (champs lienType / lienElement des éléments
// ti5) : le nom de la faction, de l'événement... ou la sorte de lien. Les
// listes de l'éditeur l'affichent après le nom pour distinguer les homonymes
// (« Cuirassé — Université de Jol-Nar »). Rien pour un élément commun.
const SORTES_DE_LIEN = {
    faction: "faction",
    neutre: "faction neutre",
    evenement: "événement",
    mercenaire: "mercenaire",
    special: "spécial",
}

function etiquetteLien(content, noms) {

    const type = content?.lienType

    if (!type || type === "commun") {
        return undefined
    }

    const nom = Number(content.lienElement?.id) > 0 ? noms.get(Number(content.lienElement.id)) : null

    // (sans le préfixe !...! des anciens noms)
    return nom ? String(nom).replace(/^(![^!]*!)+/, "") : SORTES_DE_LIEN[type]
}

export async function getSearch(jeu) {
    let element = await db.elements.aggregate([{ "$match": { "meta.jeu": { "$eq": jeu } } }, { "$sort": { "meta.created": 1 } }, { $group: { _id: "$id", "doc": { "$last": "$$ROOT" } } }]).toArray();
    element = element.map(e => e.doc).filter(d => d.meta.status !== "DELETED")

    const noms = new Map(element.map(d => [d.id, d.content?.name]))

    return element.map(d => ({
        jeu: d.meta.jeu,
        type: d.meta.type,
        id: d.id,
        name: d.content?.name,
        lie: etiquetteLien(d.content, noms),
    }))
}




export async function getListElement(jeu, type) {
    let element = await db.elements.aggregate([{ "$match": { "meta.type": { "$eq": type }, "meta.jeu": { "$eq": jeu } } }, { "$sort": { "meta.created": 1 } }, { $group: { _id: "$id", "doc": { "$last": "$$ROOT" } } }]).toArray();
    element = element.map(e => e.doc)
    element = element.filter(e => e.meta.status !== "DELETED")
    element = element.sort((a, b) => a.content.name.localeCompare(b.content.name))
    return element
}




// Anciens noms de type : une restauration d'ancienne version reprend le nom actuel.
const TYPE_ALIASES = {
    followyn: { "character:": "character" }
}

export async function buildElement(content, jeu, type, id, u, status) {
    type = TYPE_ALIASES[jeu]?.[type] ?? type
    let nid
    if (id === 0)
        nid = await nextId("element")
    else
        nid = id


    let data = { id: nid, content: content, meta: {} }

    data.meta.author  = {
        id: u.id,
        name: u.name
    }

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


// Incrément atomique : deux créations simultanées ne peuvent pas obtenir le même id.
async function nextId(id) {
    const val = await db.ids.findOneAndUpdate(
        { id },
        { $inc: { val: 1 } },
        { upsert: true, returnDocument: "after" }
    )
    return val.val
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
                "meta.created": -1,
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


export async function getElementVersion(id, version) {

    let objectId;

    try {
        objectId = new ObjectId(version);
    } catch {
        return null;
    }

    return await db.elements.findOne({
        _id: objectId,
        id: parseInt(id)
    });
}


export async function getElementVersions(id) {

    return await db.elements.find(
        {
            id: parseInt(id)
        },
        {
            projection: {
                _id: 1,
                meta: 1
            }
        }
    )
        .sort({
            "meta.created": -1
        })
        .toArray();
}


export async function restoreElement(id, version, user) {

    const original = await getElementVersion(id, version);

    if (!original) {
        return null;
    }

    const restored = await buildElement(
        structuredClone(original.content),
        original.meta.jeu,
        original.meta.type,
        parseInt(id),
        user,
        "RESTORED"
    );

    return await db.elements.insertOne(restored);
}


export async function getDeletedElements(jeu) {

    const result = await db.elements.aggregate([

        // Toutes les versions du jeu
        {
            $match: {
                "meta.jeu": jeu
            }
        },

        // Plus récente en premier pour chaque élément
        {
            $sort: {
                id: 1,
                "meta.created": -1,
                _id: -1
            }
        },

        // On récupère uniquement la dernière version
        {
            $group: {
                _id: "$id",
                latest: {
                    $first: "$$ROOT"
                }
            }
        },

        // On garde uniquement les éléments supprimés
        {
            $match: {
                "latest.meta.status": "DELETED"
            }
        },

        // On ne renvoie que ce dont la page Deleted a besoin
        {
            $project: {
                _id: "$latest._id",
                id: "$latest.id",
                name: {
                    $ifNull: [
                        "$latest.content.name",
                        ""
                    ]
                },
                type: "$latest.meta.type",
                jeu: "$latest.meta.jeu",
                created: "$latest.meta.created",
                author: "$latest.meta.author",
                status: "$latest.meta.status"
            }
        },

        // Plus récemment supprimés en premier
        {
            $sort: {
                created: -1
            }
        }

    ]).toArray();

    return result;
}


export async function restoreDeletedElement(id, user) {

    const parsedId = parseInt(id, 10);

    // Récupère toutes les versions, de la plus récente à la plus ancienne
    const versions = await db.elements.find(
        {
            id: parsedId
        }
    )
    .sort({
        "meta.created": -1,
        _id: -1
    })
    .toArray();

    if (!versions.length) {
        return null;
    }

    // La dernière version doit être DELETED
    const deleted = versions[0];

    if (deleted.meta?.status !== "DELETED") {
        return null;
    }

    // On cherche la dernière vraie version avant le DELETE
    const original = versions.find(
        version =>
            version.meta?.status !== "DELETED"
    );

    if (!original) {
        return null;
    }

    const restored = await buildElement(
        structuredClone(original.content),
        original.meta.jeu,
        original.meta.type,
        parsedId,
        user,
        "RESTORED"
    );

    return await db.elements.insertOne(restored);
}
