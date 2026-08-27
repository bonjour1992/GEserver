import { ObjectId } from "mongodb";

export let db = { remplacement: null }




export function getAll(jeu) {
    return db.remplacement.find({ jeu: jeu }).toArray()
}

export async function update(elems, jeu) {
    elems.forEach(async elem => {
        elem.jeu = jeu
        elem._id=new ObjectId(elem._id)
        let e = { ...elem }
        delete e._id

        await db.remplacement.replaceOne({ _id: new ObjectId(elem._id) }, elem,{upsert:true})

    });
}