# Adding opencv to an electron build

## OpenCV Native module support

Build opencv libraries for mac:

```bash
cd release/app
npm install @u4/opencv4nodejs
npm run cv-electron-rebuild
```

This builds opencv into node_modules/@u4/opencv-build/dist/opencv-4.5.4-8b1ea/build/lib. The 8b1ea value is a has of the build options and can change.  Currently this is hardwired into opencv4nodejs/binding.gpy as a library path.

Part of the cv-electron-rebuild runs the custom remove-symlinks npm script that  removes symlinks from the opencv-build/dist folder because the mac signing utility will skip signing files that are symlinks.  This is needed when packaging as a .dmg file.

The warning 'built for newer macOS version (13.0) than being linked (11.0)' comes from the xxx file which specifies targeting 11.

## Typescript typings support

```bash
cd <top level>
npm install @u4/opencv4nodejs --save-dev
npm start
```

## Building mac dmg installer

```bash
npm run macbuild
```

The build output can be found in release/build.

To test the build without installing, use `open release/build/mac/CrewTimer\ FinishLynx\ Connect.app/`
