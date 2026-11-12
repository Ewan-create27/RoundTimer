# Round Timer

Application mobile de chronométrage sportif par rounds, pensée pour la boxe, le HIIT, les tractions et les pompes. Elle fonctionne sans compte, sans base de données et sans serveur.

## Contenu du dossier

- `index.html` : interface de l’application
- `app.js` : logique du chronomètre, alertes audio et stockage local
- `styles.css` : design mobile noir, anthracite et rouge
- `manifest.webmanifest` et `sw.js` : installation PWA et mode hors connexion
- `icons/` : icônes de l’application

## Mettre le projet sur GitHub

1. Sur GitHub, crée un nouveau dépôt nommé par exemple `round-timer`.
2. Sélectionne `Private` pour conserver le code privé.
3. Ne coche pas l’option qui ajoute un README, un `.gitignore` ou une licence : ils sont déjà fournis ici.
4. Ouvre ce dossier dans un terminal puis exécute :

```bash
git init
git add .
git commit -m "Initial Round Timer PWA"
git branch -M main
git remote add origin https://github.com/TON-COMPTE/round-timer.git
git push -u origin main
```

Tu peux aussi ouvrir le dossier dans GitHub Desktop, créer le dépôt depuis l’application, puis cliquer sur `Publish repository` en gardant l’option de dépôt privé activée.

## Tester en local

Dans ce dossier, lance :

```bash
python3 -m http.server 4173
```

Puis ouvre `http://localhost:4173`. Un serveur local est nécessaire pour tester le mode hors connexion et le service worker.

## Déployer sur Render

Après avoir poussé le dépôt GitHub :

1. Dans Render, crée un `Static Site`.
2. Sélectionne le dépôt `round-timer`.
3. Laisse la commande de build vide.
4. Mets `.` comme répertoire de publication.
5. Déploie le site.

Le HTTPS fourni par Render est nécessaire pour l’installation PWA et pour le maintien de l’écran allumé lorsque le navigateur le prend en charge.
