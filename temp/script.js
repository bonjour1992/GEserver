import { getAll, update } from "../remp.js";

export async function csstoarray() {
    let remp = await getAll("ti5")

    remp = remp.map(element => {
        return {
            ...element,
            css: element.css ?
                Object.keys(element.css).map(e => [e, element.css[e]])
                : []
        }
    });
   console.log(await update(remp,"ti5"))
}