"use server"


import {isSignedIn} from "@/lib/actions/auth";
import {getServerEnv} from "@schema";
import {PutObjectCommand} from "@aws-sdk/client-s3";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";
import {s3} from "@/lib/create-s3-client";
import {storageObjectUrl} from "@/lib/storage-object-access";
import {db, messages} from "@db";
import {eq} from "drizzle-orm";

export async function createAttachmentUploadUrl(input: {
    fileName: string;
    contentType: string;
    messageId: string;
}) {
    const user = await isSignedIn();
    if (!user) throw new Error("Unauthorized");
    const { S3_BUCKET } = getServerEnv();

    const ext = input.fileName.includes(".")
        ? input.fileName.split(".").pop()
        : "";

    const key = `private/${user.id}/${input.messageId}/${crypto.randomUUID()}${
        ext ? `.${ext}` : ""
    }`;

    const command = new PutObjectCommand({
        Bucket: S3_BUCKET!,
        Key: key,
        ContentType: input.contentType || "application/octet-stream",
    });

    const uploadUrl = await getSignedUrl(s3, command, {
        expiresIn: 300,
    });

    return {
        uploadUrl,
        key,
    };
}


export async function createAttachmentDownloadUrl(path: string) {
    const user = await isSignedIn();
    if (!user) throw new Error("Unauthorized");

    return { url: storageObjectUrl(path) };
}

export async function getRawMessageDownloadUrl(messageId: string) {
    const [message] = await db.select().from(messages).where(eq(messages.id, messageId))
    if (!message?.rawStorageKey) return { url: null };

    return { url: storageObjectUrl(message.rawStorageKey) };
}



export async function uploadContactProfileAction(params: {
    mainFile: File;
    thumbFile: File;
    mainPath: string;
    thumbPath: string;
}) {
    const { mainFile, thumbFile, mainPath, thumbPath } = params;

    const mainBuffer = Buffer.from(await mainFile.arrayBuffer());
    const thumbBuffer = Buffer.from(await thumbFile.arrayBuffer());

    await Promise.all([
        s3.send(
            new PutObjectCommand({
                Bucket: process.env.S3_BUCKET!,
                Key: mainPath,
                Body: mainBuffer,
                ContentType: mainFile.type,
            })
        ),
        s3.send(
            new PutObjectCommand({
                Bucket: process.env.S3_BUCKET!,
                Key: thumbPath,
                Body: thumbBuffer,
                ContentType: thumbFile.type,
            })
        ),
    ]);

    return { success: true };
}
