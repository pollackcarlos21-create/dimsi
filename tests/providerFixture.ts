export function validRecognitionJson(): string {
  return JSON.stringify({
    meal_name: '青椒肉丝配米饭',
    foods: [
      {
        name: '米饭',
        category: 'staple',
        portion_g: 150,
        portion_low_g: 120,
        portion_high_g: 180,
        confidence: 'medium',
        preparation: 'steamed',
      },
      {
        name: '青椒肉丝',
        category: 'mixed',
        portion_g: 160,
        portion_low_g: 130,
        portion_high_g: 190,
        confidence: 'medium',
        preparation: 'stir_fried',
      },
    ],
    oiliness: 'medium',
    saltiness_risk: 'medium',
    observation: '两盘家常菜。',
  });
}
