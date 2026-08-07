import config from "@iobroker/eslint-config";
export default [
  { ignores: ["admin/i18n/**"] },
  ...config,
  {
    files: ["test/**/*.js"],
    languageOptions: { globals: { describe: "readonly", it: "readonly" } },
  },
];
