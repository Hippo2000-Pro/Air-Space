# Air Space

Application web de présentation et de gestion des demandes de spectacles Air Space dans le Rhône.

## Fonctionnalités

- Site public adapté au téléphone : concept, formules, contact, dons et demande de réservation.
- Navigation mobile par onglets et pages distinctes : accueil, agenda, créations, boutique, spectacles, studio 3D, Air Lab et contact. Pas de profil public ni de compte visiteur.
- Personnalisation de la fusée pour l’anniversaire, jointe à la demande.
- Espace équipe privé avec rôles et accès séparés, calendrier, horaires, réponses préparées et gestion des comptes.
- Réglages des tarifs et textes du site depuis l’espace équipe.
- Suivi du budget réservé au propriétaire : plafond modifiable, dépenses payées ou prévues, catégories, filtres, modification, suppression et export CSV.
- Données conservées dans une base SQLite sur le serveur.

Le budget de départ est de 5 000 €. Les tarifs, les coordonnées et les informations réelles doivent être vérifiés et complétés par l’équipe avant toute ouverture publique. Les courriels sont préparés pour révision dans le logiciel de messagerie; ils ne sont pas envoyés automatiquement.

## Lancement local sur Windows

1. Installe Python 3.10 ou plus récent.
2. Double-clique sur **Lancer Air Space.bat** et garde la fenêtre ouverte.
3. Ouvre l’adresse **Site public** pour voir le site visiteur, ou **Espace équipe** pour créer le premier compte propriétaire et gérer l’application.
4. Après les changements de code, actualise la page. Les changements de réglages sauvegardés sont servis par la base de données.

Ne lance pas `index.html` directement : les demandes et l’espace équipe nécessitent le serveur Python. `preview-server.js` ne sert qu’à l’aperçu visuel.

## Données et sauvegardes

Les données sont enregistrées dans `air_space.sqlite3`. Ce fichier peut contenir des informations personnelles de réservation et de compte : ne le publie pas et ne le partage pas. Arrête le serveur avant d’en faire une copie de sauvegarde. Le ZIP pour ton cousin contient une base de démonstration séparée; la base réellement utilisée par l’application n’est jamais copiée dans ce paquet.

Le ZIP « aperçu pour le cousin » est une exception de démonstration : il contient une base séparée avec des données entièrement fictives et un compte directeur de démonstration. Les identifiants sont dans `APERÇU-ET-ACCÈS.txt`. N’utilise jamais cette base ou ce compte pour une publication Internet; remplace la base par une base neuve et crée un vrai compte propriétaire avant le lancement.

## Avant une publication sur Internet

Cette livraison est une application locale, pas un déploiement Internet. `127.0.0.1` n’est accessible que depuis l’ordinateur qui exécute l’application. Pour recevoir des réservations publiques, il faut d’abord installer l’application sur un hébergeur HTTPS, configurer un stockage persistant pour SQLite, mettre en place la création initiale du compte propriétaire et vérifier les sauvegardes, les règles de confidentialité et la gestion des incidents. Les paramètres `AIR_SPACE_HOST`, `PORT`, `AIR_SPACE_DB`, `AIR_SPACE_HTTPS`, `AIR_SPACE_OPEN_BROWSER` et `AIR_SPACE_ALLOW_SETUP` servent à l’adaptation du serveur; la mise en place de ces paramètres ne remplace pas une revue de sécurité et un essai sur l’hébergeur.

Avant d’ouvrir le site, un adulte responsable doit vérifier les conditions des spectacles, le lieu et les mesures de sécurité, les tarifs, les coordonnées de contact et le compte de don. Les champs de don restent vides tant que le compte n’est pas prêt. Le présent projet n’inclut pas le traitement de paiements.

## Installation comme application

Sur l’ordinateur du serveur, ouvre l’adresse du site dans Edge ou Chrome et utilise le menu du navigateur pour installer Air Space. L’installation sur d’autres appareils et l’accès des clients nécessitent une adresse HTTPS publique. Les formulaires, les réservations et l’espace équipe ne fonctionnent pas hors ligne.

## Fonctionnalités publiques pilotées par l’équipe

Les visiteurs peuvent consulter la boutique, envoyer une demande de commande, voir le calendrier des spectacles publics, lire les actualités et informations publiées, voir les vidéos et utiliser AirBot, Air-Vote, Air-Points, EcoTracker et les suggestions communautaires. Aucun compte visiteur n’est créé. Les comptes d’équipe restent dans l’espace privé.

Les rubriques publiques disposent de liens directs : `/agenda`, `/creations`, `/boutique`, `/spectacles`, `/air-ar`, `/air-lab`, `/airbot`, `/air-vote`, `/ecotracker`, `/air-points`, `/reservation` et `/contact`. Le menu inférieur mobile garde les cinq entrées principales visibles. L’onglet Profil de la maquette est volontairement omis : aucun compte visiteur n’est créé.

Depuis **Espace équipe → Centre de pilotage public**, les personnes autorisées gèrent les articles et demandes de la boutique, événements, vidéos, actualités, partenaires, missions et scores Air-Points, réponses d’AirBot/FAQ, données EcoTracker, votes, pages d’information et la modération des suggestions.

La boutique propose une recherche, des filtres et un tri des articles, avec une demande de commande sans compte ni paiement. AirBot est un assistant spécialisé Air Space : il retrouve les tarifs, événements, vidéos, informations de réservation et réponses validées par l’équipe. Il répond uniquement avec les contenus du projet et ne remplace pas une personne de l’équipe.

Les Air-Points sont anonymes, conservés par identifiant aléatoire sur l’appareil du visiteur, et n’ont pas de valeur ou récompense commerciale. La boutique enregistre une demande de contact, pas un paiement. Les textes légaux restent à compléter et vérifier avec un adulte responsable avant publication.
