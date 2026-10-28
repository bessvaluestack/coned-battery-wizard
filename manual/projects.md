::: pages
# Projects
:::
::: hosted
# Projects and versions
:::

A project is one battery analysis with a stable identity: a name and a project ID shown in the header. The ID follows the project into every download, so the financial model can always tell which analysis its numbers came from. With it goes a **configuration fingerprint**, a short code that changes whenever any input changes.

::: pages
## Project files

The wizard keeps the open project in your browser, inputs only. The header has:

| Button | What it does |
|---|---|
| Save project | Downloads a project file, `<name>.coned-battery.json`, with every input and any uploaded interval data |
| Open project | Loads a project file back |
| New project | Starts over with a new project ID; click twice to confirm. The open project is not kept, so save it first |

Results are not saved: after opening a project, run it again. The same inputs always give the same results.

> [!TIP]
> Keep the project file with the pro-forma it produced: the file's project ID and fingerprint match the workbook's Wizard_Import sheet.
:::
::: hosted
## Versions on the server

The site keeps every project on its server. Nothing is ever deleted: every save is a new version and earlier ones stay readable.

| Button | What it does |
|---|---|
| Save version | Saves the inputs, and the last run if there is one, as a new version |
| Projects | Every project on the server, most recently saved first, with its number of versions and its last run's net benefit |
| Versions | Every version of the open project: when, by whom, the inputs fingerprint and the run |
| Copy link | Copies the link to the open version (see below) |
| New project | Starts a new project; the others stay on the server |

**Every run saves itself** as a new version, with its results. Opening a version brings its results back as they were, marked *Kept run*, without solving again. If the wizard or the rates have changed since it ran, it opens with its inputs and a note to run again, rather than showing numbers made under different rules.

**Saved by**: the Projects list has a box for your name. Saves from this browser are recorded under it.

**When someone else saved first**: if another version was saved after the one you opened, your save is refused with a note. Open the latest from Versions, or click *Save as a new version anyway*. Either way, nothing is lost.

> [!WARNING]
> There are no logins. Anyone with the site's address can open, change and save any project. Undo a bad save by opening an earlier version and saving it again.

## Project links

Every saved version has a link:

```
https://<site>/#project=<project ID>&version=<n>
```

It opens that exact version with its inputs and its run, for anyone who has the link. Without `&version=` it opens the latest version.

- The address bar always shows the open version's link, so copying the address works too.
- **Copy link** in the header copies the open version's link; each row of **Versions** has its own.
- On a plain `http://` address (a test address on the local network, say) browsers do not let the page use the clipboard. The link is shown instead, to copy by hand.
- Reloading the page on the open version keeps any edits made since the last save.

The pro-forma carries the same link and the version number, so the workbook points back to the exact saved analysis: see [The owner pro-forma](proforma.md#saved-analysis-and-links).
:::
