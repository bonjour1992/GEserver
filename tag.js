export let db = { tag: null }


export function get() {
    return db.tag.find().toArray()
}

export async function add(type,value ) {


        return  db.tag.insertOne({ type:type, value:value})


}