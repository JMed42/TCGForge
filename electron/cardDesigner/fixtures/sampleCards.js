// Sample card rows for the Phase 0 spike: one with every field, one with no image,
// one designed to stress overflow. Shapes match rows from the cards table.

function sampleCards(art) {
  return [
    {
      name: 'Ember Drake',
      type: 'Creature — Dragon',
      set_name: 'Core Set',
      rarity: 'Rare',
      cost: '5',
      power: '4',
      toughness: '3',
      rules_text: 'Flying. When Ember Drake enters play, deal 2 damage to each opposing creature with toughness 2 or less.',
      flavor_text: '"The mountains remember every fire it has ever breathed."',
      tags: 'dragon,fire,flying',
      custom_fields: JSON.stringify({ element: 'Fire', artist: 'Procedural' }),
      notes: 'Phase 0 spike: every built-in field populated.',
      image_path: art.ember,
    },
    {
      name: 'Nameless Wanderer',
      type: 'Creature — Human',
      set_name: 'Core Set',
      rarity: 'Common',
      cost: '1',
      power: '1',
      toughness: '1',
      rules_text: 'This card has no image_path, so the art slot renders a neutral placeholder.',
      flavor_text: '',
      tags: '',
      custom_fields: '{}',
      notes: '',
      image_path: '',
    },
    {
      name: 'Tidecaller of the Seventeen Drowned Lighthouses',
      type: 'Legendary Creature — Merfolk Wizard',
      set_name: 'Deep Waters',
      rarity: 'Mythic',
      cost: '12',
      power: '10',
      toughness: '10',
      rules_text: 'Whenever you draw a card, scry 1. At the beginning of your upkeep, return target creature card from your graveyard to your hand, then shuffle your library. If you control seven or more Islands, creatures you control get +2/+2 and have ward 3. This text is deliberately long to force shrink.',
      flavor_text: 'Seventeen lights went dark in a single night; she answered every one of them.',
      tags: 'merfolk,wizard',
      custom_fields: JSON.stringify({ element: 'Water' }),
      notes: 'Overflow stress card.',
      image_path: art.tide,
    },
  ];
}

module.exports = { sampleCards };
