# Formation « Espace d'administration » — prise en main

Support de formation (29 diapositives) expliquant l'espace d'administration de D-aôna
à des non-informaticiens : les 9 modules, les 7 rôles, les permissions, le journal d'audit.

| Fichier | Rôle |
|---|---|
| `D-aona - Administration (prise en main).pptx` | le diaporama (16:9, notes du présentateur sur chaque diapo) |
| `build_pptx.py` | le génère à partir des captures |
| `captures/*.jpg` | 14 captures d'écran réelles + 3 recadrages (`*detail*`, `05-kyc-detail`) |

## Régénérer

```powershell
# 1. capturer les écrans — base NEUVE et JETABLE, jamais la base réelle
cd d-aona-server
node test/ui/capture_admin.js          # → docs/formation-admin/captures/ (14 images)

# 2. fabriquer le diaporama (python-pptx + Pillow)
cd ..
py docs/formation-admin/build_pptx.py  # → docs/formation-admin/*.pptx + copie sur le Bureau
```

`capture_admin.js` crée une base temporaire dans `%TEMP%`, y applique les migrations,
inscrit `GuideAdmin` par le vrai formulaire, y verse `demo_seed.js` + un rôle
`super_admin`, fabrique six dossiers d'identité avec les PNG de `test/kyc_fixtures.js`,
puis supprime tout (base, serveur sur le port 8097, dossier temporaire).

**Règle absolue : aucune donnée réelle sur les images.** Ni les comptes de production, ni
les pièces de `private/kyc/`. Les visages et les cartes d'identité sont des aplats de test.

`docs/formation-admin/` est jetable : si les captures vieillissent, relancer les deux
commandes suffit — le contenu des diapositives est dans `build_pptx.py`.

## Maquette HTML (retouches à la main)

Pour améliorer le back-office sans serveur ni compte, un second script produit un **fichier
HTML unique et autonome** posé sur le Bureau :

```powershell
cd d-aona-server
node test/ui/export_admin_html.js
# → C:\Users\<vous>\Desktop\D-aona - Administration (démo).html  (~740 Ko)
```

Il monte la même instance jetable (port **8098**, base temporaire), ouvre chacune des 11 vues
dans la vraie application et **clone le DOM rendu** : mêmes classes, mêmes libellés, mêmes
tableaux, mêmes états. Le CSS est copié **tel quel** depuis le bloc `<style>` de
`d-aona-web/index.html`. Une barre noire, en haut du fichier, fait passer d'une vue à l'autre et
bascule jour/nuit ; les boutons de l'application y sont **inertes** (les `on*` sont retirés, les
images inlinées en `data:`).

| Ce qu'on édite dans le fichier | Où le reporter ensuite |
|---|---|
| `<style id="daona-design-system">` | `d-aona-web/index.html`, section « ADMINISTRATION (gestionnaire de modules) » (`.adm*`) |
| `<section class="screen" data-demo-view="…">` | la fonction `admXxxView()` correspondante dans `index.html` |
| `<style id="maquette-coque">` | **nulle part** : c'est la barre de la maquette, elle n'existe pas dans l'application |

Limites assumées : la barre d'onglets du bas et le bouton de discussion ne sont pas repris (hors
écran d'administration), les polices viennent de Google Fonts (donc le rendu est exact seulement
avec une connexion), et les deux bannières du jeu de démonstration pèsent à elles seules ~340 Ko
du fichier — les retirer du seed allège l'export d'autant.
