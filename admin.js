// CAMBIO CLAVE: SOPORTE MULTIPLE IMAGENES

window.subirImgDestino = async function(e) {
  const files = e.target.files;
  if (!files || !files.length) return;

  const input = document.getElementById("d-imgs");
  let current = input.value ? input.value.split("\n") : [];

  const urls = [];

  for (const file of files) {
    try {
      const url = await uploadImage(file);
      urls.push(url);
    } catch (err) {
      console.error("Error subiendo imagen:", err);
    }
  }

  input.value = [...current, ...urls].join("\n");

  showToast("📷 Imágenes subidas");
};


// EN guardarDestino CAMBIAR A:

imagenes: (document.getElementById("d-imgs").value || "")
  .split("\n")
  .map(s => s.trim())
  .filter(Boolean),

