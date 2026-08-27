import { MongoClient } from "mongodb";
export let DB

export async function DBInit()
{
    DB= dbConnect()
}

 async function  dbConnect(){

const uri = process.env.MONGODB_URI 
const options = {};

let client;
let clientPromise

if (!process.env.MONGODB_URI) {
  throw new Error("Please add MONGODB_URI to .env.local");
}


client = new MongoClient(uri, options);


clientPromise = client.connect();
 return (await clientPromise).db(process.env.DATABASE);

 }