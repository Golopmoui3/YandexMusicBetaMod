declare module "*.css?inline" {
  const contents: string;
  export default contents;
}

declare module "*.png?inline" {
  const source: string;
  export default source;
}

declare module "*.webp?inline" {
  const source: string;
  export default source;
}

interface ImportMetaEnv {
  readonly VITE_MOD_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
