import * as dree  from 'dree'


const options = {
    depth: 10,
    // exclude: "",       // To exclude some pahts with a regexp
    extensions: ['svg', 'jpg', 'png', 'jpeg'],    // To include only some extensions
    stat: false,
    size: false,
};



export async function getImage() {
    let tree;
    tree = await dree.scanAsync('./public', options);
    return tree
}