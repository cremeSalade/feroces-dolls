+++
title = "Qui peut venir aux goûters des Féroces Dolls ?"
date = "2026-02-16T18:00:00+01:00"
image = "bandeau_trans.jpg"
image_alt = "Affiche des goûters transfem*"
draft = false
+++

On nous pose souvent la question : **Est-ce que moi je peux venir aux goûters des Féroces Dolls ?**

Les goûters sont en **{{< terme "mixite-choisie" "mixité choisie" >}} {{< terme "transfem" "transfem+" >}}**, mais c'est pas toujours exactement clair non plus qui ça concerne exactement.

Le plus efficace est d'utiliser ce schéma indicatif. Mais si tu as un doute, tu peux toujours nous écrire :)

```mermaid
flowchart TD
    A0(Est-ce que tu veux venir aux goûters des Féroces Dolls ?) -->|OUI !| A
    A(À quel genre as-tu été assigné·e à la naissance ?) -->|Tu as été assigné·e garçon| B(Est-ce que tu es un homme ?)
    A -->|Tu as été assigné·e fille| C(Est-ce que tu as, ou as eu, un parcours de transition et/ou de détransition qui t'expose aujourd'hui à de la transmisogynie, tout en t'identifiant plutôt féminine ?)
    A -->|Ni l'un ni l'autre, notamment en étant inter et/ou venant d'une culture avec plus de 2 genres| D(Est-ce que tu subis de la transmisogynie ?)
    B -->|Non| E(Pas de souci, viens aux goûters, pense à lire et respecter la charte.)
    B -->|Oui| F(Est-ce que tu es en questionnement par rapport à ton genre, et/ou genderfluid, et/ou de genre non conforme ?)
    B -->|C'est compliqué| G(T'inquiète, c'est compliqué pour tout le monde.) --> F
    F -->|Oui| E
    F -->|Non| J(Désolé, ce n'est pas contre toi: on essaie de garder une mixité choisie. Tu peux quand même aider via la caisse de solidarité. Pour militer, tu peux aussi rejoindre le Planning Familial par exemple. Si tu es une personne non trans ayant besoin de conseils ou d'accès aux hormones injectables, tu peux demander à venir à certains ateliers.)
    C -->|Non| J
    C -->|Oui| E
    D -->|Oui| E
    D -->|Non| J

    %% Épaisseur uniforme des bords/nœuds
    classDef fdNode stroke-width:2px
    class A0,A,B,C,D,E,F,G,J fdNode

    %% Épaisseur uniforme des flèches
    linkStyle default stroke-width:2px

    %% Branches "Oui" en rose
    linkStyle 0,5,8,11,12 stroke:#CC84BC,stroke-width:2px,color:#B96EA7
    %% Branches "Non" en violet
    linkStyle 4,9,10,13 stroke:#6C2062,stroke-width:2px,color:#6C2062

    %% Cases finales
    style E fill:#F8EAF3,stroke:#B96EA7,stroke-width:2px,color:#2F2230
    style J fill:#F3ECF8,stroke:#6C2062,stroke-width:2px,color:#2F2230
```

Merci de respecter la mixitée choisie, elle sert à protéger un espace de sociabilisation et de soutien pour des personnes exposées à des violences.

