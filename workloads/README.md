# Test your own AI project

Every project Bakeoff tests is a folder in here. Bakeoff finds the folders on its own, so adding a project takes no changes to the engine or the screens.

1. Copy `_template` to a new folder, like `workloads/my-app`.
2. In `meta.ts`, set `id` to the folder name and describe your project's AI jobs. Give each job a unique `type`, and set its `workload` to the folder name.
3. In `index.ts`, write `buildPrompt` to make the prompt your app sends, and `runChecks` to grade the things a script can check.
4. In `tasks.json`, add tasks with made-up data. Never use real customer data. Mark some `dev` and some `holdout`, so a pick is proven on tasks it never saw.
5. Restart Bakeoff. Your project shows up on the Workload and New run pages.

The folder stays on your machine, because `.gitignore` only shares `scout-sdr` and the template. Add a line to `.gitignore` if you want to share yours.

A project can also add its own commands to `npm run bakeoff` through `commands` in its plugin.
