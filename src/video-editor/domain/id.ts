import { nanoid } from "nanoid";

const createId = (): string => nanoid(12);

export const createEntityId = (): string => createId();
