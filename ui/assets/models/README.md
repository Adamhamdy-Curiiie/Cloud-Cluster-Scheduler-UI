# Optional hospital characters

Drop a `.glb` or `.gltf` character directly in this directory and run the UI again.
The scene discovers these files locally; no manifest or code change is needed.
`patient.glb` or `patient.gltf` is preferred, otherwise the first character file
is used for patients. An optional `doctor.glb` / `doctor.gltf` replaces the doctor.
Keep any `.bin` and textures alongside their glTF, using relative or embedded URLs.
Use an uncompressed glTF 2.0 export; Draco/KTX decoder downloads are not enabled.
An embedded animation with “walk” in its name plays during travel. Characters
are normalized to standing height; primitive characters remain the fallback if
loading fails. Model files are loaded once per scene, then cloned for patients.

The loader can be disabled through `createScene3D({ ..., loadModels: false })`.
New files are discovered whenever a new 3D scene is created (rerun or toggle).
