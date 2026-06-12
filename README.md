# 🥗 Calorías — contador de calorías PWA

App web gratuita para contar calorías y macros, instalable en el móvil como una app nativa (PWA). Sin cuentas, sin anuncios, sin servidores: todos los datos se guardan en tu propio dispositivo.

**Pruébala:** https://raulseoanealvarez-collab.github.io/calorias-app/

## Funciones

- 📋 **Diario** por comidas con anillo de calorías y barras de macros (proteínas, carbohidratos, grasas)
- 🎯 **Objetivos automáticos** según tu perfil (fórmula Mifflin-St Jeor) y tu meta (perder/mantener/ganar peso)
- 🔍 **Buscador de alimentos** con la base de datos de [Open Food Facts](https://world.openfoodfacts.org) (+3M de productos)
- 📷 **Escáner de códigos de barras** con la cámara
- ✨ **Foto con IA**: fotografía tu plato y la IA estima alimentos, gramos y calorías (Claude o Gemini, necesita API key propia — la de Gemini es gratuita)
- 📈 **Peso** con gráfica de evolución y resumen semanal de calorías
- 💧 Contador de **agua**
- 🍲 **Recetas** propias con cálculo de calorías por ración
- 📦 **Exportar/importar** datos en JSON
- 📴 Funciona **offline** (service worker)

## Instalación en el móvil

1. Abre la URL en Safari (iPhone) o Chrome (Android)
2. Compartir → **"Añadir a pantalla de inicio"**

## Privacidad

Todos los datos (comidas, peso, perfil, API keys) se guardan únicamente en el `localStorage` de tu navegador. Las únicas conexiones externas son las consultas a Open Food Facts y, si la activas, el envío de fotos a la IA que elijas.

## Uso propio

Es una web estática sin dependencias de build: haz fork, activa GitHub Pages y tienes tu propia copia.
