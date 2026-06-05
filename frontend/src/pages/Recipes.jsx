import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import useStore from '@/store/useStore';
import {
  getProductRecipe,
  createOrUpdateRecipe,
  deleteRecipe,
  getProductCostHistory
} from '@/services/api';
import { useConfirmDialog } from '@/components/ConfirmDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Search,
  Plus,
  Trash2,
  Save,
  RotateCcw,
  Zap,
  Activity,
  AlertTriangle,
  History,
  Info
} from 'lucide-react';

const Recipes = () => {
  const { products, initialize, loading } = useStore();
  const [selectedProductId, setSelectedProductId] = useState('');
  const [recipe, setRecipe] = useState(null);
  const [costHistory, setCostHistory] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchingIngredient, setIsSearchingIngredient] = useState(false);
  const [ingredientQuery, setIngredientQuery] = useState('');

  // Form states
  const [lossPercentage, setLossPercentage] = useState('0');
  const [recipeYield, setRecipeYield] = useState('1');
  const [ingredients, setIngredients] = useState([]); // [{ product, quantity }]

  const { confirm, ConfirmDialog } = useConfirmDialog();
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Load recipe & history when selected product changes
  useEffect(() => {
    if (!selectedProductId) {
      setRecipe(null);
      setIngredients([]);
      setCostHistory([]);
      return;
    }
    loadProductDetails();
  }, [selectedProductId]);

  const loadProductDetails = async () => {
    try {
      setErrorMsg('');
      setSuccessMsg('');
      
      const [recipeRes, historyRes] = await Promise.all([
        getProductRecipe(selectedProductId),
        getProductCostHistory(selectedProductId)
      ]);

      const recipeData = recipeRes.data.data;
      setRecipe(recipeData);
      setCostHistory(historyRes.data.data || []);

      if (recipeData) {
        setLossPercentage(recipeData.loss_percentage.toString());
        setRecipeYield(recipeData.yield.toString());
        
        // Map recipe items to ingredients state
        const items = recipeData.items.map(item => ({
          id: item.ingredient_product_id,
          name: item.ingredient.name,
          cost: parseFloat(item.ingredient.cost) || 0,
          sku: item.ingredient.sku || '',
          quantity: item.quantity.toString()
        }));
        setIngredients(items);
      } else {
        // Reset form for new recipe
        setLossPercentage('0');
        setRecipeYield('1');
        setIngredients([]);
      }
    } catch (err) {
      setErrorMsg('Error al cargar datos: ' + (err.response?.data?.error || err.message));
    }
  };

  const selectedProduct = products.find(p => p.id === parseInt(selectedProductId));

  // Add ingredient
  const handleAddIngredient = (prod) => {
    if (ingredients.some(item => item.id === prod.id)) {
      toast.error('El ingrediente ya está agregado en la receta');
      return;
    }
    if (prod.id === parseInt(selectedProductId)) {
      toast.error('No puedes agregar el mismo producto elaborado como ingrediente');
      return;
    }

    setIngredients([
      ...ingredients,
      {
        id: prod.id,
        name: prod.name,
        cost: parseFloat(prod.cost) || 0,
        sku: prod.sku || '',
        quantity: '1'
      }
    ]);
    setIsSearchingIngredient(false);
    setIngredientQuery('');
  };

  // Remove ingredient
  const handleRemoveIngredient = (id) => {
    setIngredients(ingredients.filter(item => item.id !== id));
  };

  // Update quantity
  const handleQtyChange = (id, val) => {
    setIngredients(ingredients.map(item => 
      item.id === id ? { ...item, quantity: val } : item
    ));
  };

  // Calculate live cost
  const calculateLiveCost = () => {
    let sum = 0;
    ingredients.forEach(item => {
      const q = parseFloat(item.quantity) || 0;
      sum += q * item.cost;
    });

    const lp = parseFloat(lossPercentage) || 0;
    const y = parseFloat(recipeYield) || 1;
    const denominator = y * (1 - (lp / 100));

    if (denominator <= 0) return 0;
    return (sum / denominator);
  };

  const rawIngredientsCost = ingredients.reduce((sum, item) => {
    const q = parseFloat(item.quantity) || 0;
    return sum + (q * item.cost);
  }, 0);

  const calculatedUnitCost = calculateLiveCost();

  // Save recipe
  const handleSaveRecipe = async () => {
    if (ingredients.length === 0) {
      setErrorMsg('Debes agregar al menos un ingrediente para guardar la receta.');
      return;
    }

    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const payload = {
        loss_percentage: parseFloat(lossPercentage) || 0,
        yield: parseFloat(recipeYield) || 1,
        items: ingredients.map(item => ({
          ingredient_product_id: item.id,
          quantity: parseFloat(item.quantity) || 0
        }))
      };

      const res = await createOrUpdateRecipe(selectedProductId, payload);
      setSuccessMsg('Receta guardada con éxito. Costo recalculado.');
      
      // Reload details and global store to update cost across products list
      await loadProductDetails();
      initialize();
    } catch (err) {
      setErrorMsg(err.response?.data?.error || 'Error al guardar la receta');
    } finally {
      setSaving(false);
    }
  };

  // Delete recipe
  const handleDeleteRecipe = async () => {
    const ok = await confirm('¿Seguro que querés eliminar esta receta? El producto pasará a costo manual.');
    if (!ok) return;
    
    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await deleteRecipe(selectedProductId);
      setSuccessMsg('Receta eliminada. El producto ahora tiene costo manual.');
      loadProductDetails();
      initialize();
    } catch (err) {
      setErrorMsg('Error al eliminar receta: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  // Filter products for drop-down list
  const filteredProductsList = products.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Filter ingredients search
  const filteredIngredientsList = products.filter(p =>
    p.id !== parseInt(selectedProductId) &&
    p.name.toLowerCase().includes(ingredientQuery.toLowerCase()) &&
    p.is_active
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black tracking-tight">
          Fórmulas y <span className="text-primary">Recetas</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Diseñá recetas complejas combinando insumos y productos. El sistema actualizará el costo unitario de venta automáticamente.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Product Selection */}
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold">Seleccionar Producto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filtrar catálogo..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>

              <div className="border border-input rounded-md max-h-[350px] overflow-y-auto">
                <div className="divide-y divide-border">
                  {filteredProductsList.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedProductId(p.id.toString())}
                      className={`w-full text-left px-3 py-2.5 text-sm transition-all flex items-center justify-between hover:bg-muted ${
                        selectedProductId === p.id.toString() ? 'bg-accent text-accent-foreground font-semibold' : ''
                      }`}
                    >
                      <div className="truncate pr-2">
                        <p className="truncate font-medium">{p.name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{p.sku || 'Sin SKU'}</p>
                      </div>
                      <Badge variant={p.recipe ? 'default' : 'outline'} className="shrink-0 text-[10px]">
                        {p.recipe ? 'Con Fórmula' : 'Manual'}
                      </Badge>
                    </button>
                  ))}
                  {filteredProductsList.length === 0 && (
                    <div className="p-4 text-center text-xs text-muted-foreground">No se encontraron productos.</div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cost History Card */}
          {selectedProductId && (
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <History className="h-4 w-4 text-primary" /> Historial de Costos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-[250px] overflow-y-auto pr-1 space-y-3">
                  {costHistory.map((h, i) => (
                    <div key={h.id} className="text-xs border-l-2 border-primary pl-3 py-1 space-y-1">
                      <div className="flex justify-between font-mono">
                        <span className="font-semibold text-foreground">${parseFloat(h.new_cost).toLocaleString()}</span>
                        <span className="text-muted-foreground">{new Date(h.change_date).toLocaleDateString()}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">{h.reason}</p>
                    </div>
                  ))}
                  {costHistory.length === 0 && (
                    <div className="text-center text-xs text-muted-foreground py-6">
                      No hay variaciones de costo registradas.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column: Recipe Design */}
        <div className="lg:col-span-2">
          {selectedProductId && selectedProduct ? (
            <Card className="h-full flex flex-col">
              <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-lg font-black">{selectedProduct.name}</CardTitle>
                    <Badge variant={recipe ? 'default' : 'secondary'}>
                      {recipe ? 'Fórmula Activa' : 'Costo Manual'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono mt-1">
                    Costo actual: ${parseFloat(selectedProduct.cost).toLocaleString()} | SKU: {selectedProduct.sku || '–'}
                  </p>
                </div>
                {recipe && (
                  <Button variant="destructive" size="sm" onClick={handleDeleteRecipe} disabled={saving}>
                    <Trash2 className="h-4 w-4 mr-1" /> Eliminar Receta
                  </Button>
                )}
              </CardHeader>

              <CardContent className="p-6 flex-1 flex flex-col space-y-6">
                {/* Error and Success alerts */}
                {errorMsg && (
                  <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                )}
                {successMsg && (
                  <div className="bg-emerald-500/10 text-emerald-500 text-sm p-3 rounded-md flex items-start gap-2">
                    <Info className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{successMsg}</span>
                  </div>
                )}

                {/* Parameters: Yield and Loss */}
                <div className="grid grid-cols-2 gap-4 bg-muted/30 p-4 rounded-lg">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Rendimiento de Fórmula
                    </label>
                    <Input
                      type="number"
                      min="0.0001"
                      step="any"
                      value={recipeYield}
                      onChange={e => setRecipeYield(e.target.value)}
                      placeholder="Cantidad producida por la receta (ej. 1)"
                    />
                    <p className="text-[10px] text-muted-foreground">Unidades/Kg finales elaborados con esta mezcla.</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Merma de Producción (%)
                    </label>
                    <Input
                      type="number"
                      min="0"
                      max="99.9"
                      step="any"
                      value={lossPercentage}
                      onChange={e => setLossPercentage(e.target.value)}
                      placeholder="Porcentaje de desperdicio"
                    />
                    <p className="text-[10px] text-muted-foreground">Porcentaje del material perdido en el proceso.</p>
                  </div>
                </div>

                {/* Ingredients List */}
                <div className="space-y-3 flex-1 flex flex-col">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold tracking-tight">Ingredientes / Insumos</h3>
                    {!isSearchingIngredient ? (
                      <Button size="xs" onClick={() => setIsSearchingIngredient(true)}>
                        <Plus className="h-3 w-3 mr-1" /> Agregar Ingrediente
                      </Button>
                    ) : (
                      <Button size="xs" variant="ghost" onClick={() => setIsSearchingIngredient(false)}>
                        Cancelar
                      </Button>
                    )}
                  </div>

                  {/* Add Ingredient Popup Panel */}
                  {isSearchingIngredient && (
                    <div className="border border-primary/20 bg-muted/60 p-3 rounded-lg space-y-3">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                          placeholder="Buscar ingrediente..."
                          value={ingredientQuery}
                          onChange={(e) => setIngredientQuery(e.target.value)}
                          className="pl-8 text-xs h-8"
                          autoFocus
                        />
                      </div>
                      <div className="max-h-[150px] overflow-y-auto text-xs divide-y divide-border border border-border rounded bg-card">
                        {filteredIngredientsList.map(prod => (
                          <div
                            key={prod.id}
                            onClick={() => handleAddIngredient(prod)}
                            className="p-2 hover:bg-muted cursor-pointer flex justify-between items-center"
                          >
                            <div>
                              <p className="font-semibold">{prod.name}</p>
                              <p className="text-[9px] text-muted-foreground font-mono">Costo base: ${parseFloat(prod.cost).toLocaleString()}</p>
                            </div>
                            <Badge className="text-[8px]">Seleccionar</Badge>
                          </div>
                        ))}
                        {filteredIngredientsList.length === 0 && (
                          <div className="p-3 text-center text-muted-foreground">No se encontraron productos disponibles.</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Ingredients Table */}
                  <div className="border border-border rounded-lg flex-1 overflow-y-auto min-h-[200px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Ingrediente</TableHead>
                          <TableHead className="text-right">Costo Base</TableHead>
                          <TableHead className="w-28 text-center">Cantidad</TableHead>
                          <TableHead className="text-right">Subtotal</TableHead>
                          <TableHead className="w-10"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ingredients.map(item => {
                          const qty = parseFloat(item.quantity) || 0;
                          const subtotal = qty * item.cost;
                          return (
                            <TableRow key={item.id}>
                              <TableCell className="font-semibold">
                                <div>
                                  <p>{item.name}</p>
                                  <p className="text-[9px] text-muted-foreground font-mono">{item.sku || 'Sin SKU'}</p>
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-mono">${item.cost.toLocaleString()}</TableCell>
                              <TableCell className="text-center">
                                <Input
                                  type="number"
                                  min="0.0001"
                                  step="any"
                                  value={item.quantity}
                                  onChange={e => handleQtyChange(item.id, e.target.value)}
                                  className="h-8 text-center text-xs font-mono"
                                />
                              </TableCell>
                              <TableCell className="text-right font-mono font-bold">${subtotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</TableCell>
                              <TableCell className="text-center">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive hover:bg-destructive/10"
                                  onClick={() => handleRemoveIngredient(item.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {ingredients.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center py-8 text-xs text-muted-foreground">
                              No hay ingredientes agregados. Haz clic en "Agregar Ingrediente" para diseñar la fórmula.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {/* Final Estimation Panel */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border pt-4">
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div className="flex justify-between">
                      <span>Costo Materia Prima (Suma):</span>
                      <span className="font-mono">${rawIngredientsCost.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Rendimiento:</span>
                      <span className="font-mono">/ {recipeYield}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Merma Aplicada:</span>
                      <span className="font-mono">{lossPercentage}%</span>
                    </div>
                  </div>

                  <div className="bg-primary/5 border border-primary/20 p-3 rounded-lg flex flex-col justify-center items-end">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Costo Final Calculado por Unidad</span>
                    <span className="text-2xl font-black font-mono mt-1 text-primary">
                      ${calculatedUnitCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </span>
                  </div>
                </div>

                {/* Form Actions */}
                <div className="flex gap-3 justify-end pt-2">
                  <Button variant="outline" onClick={loadProductDetails} disabled={saving}>
                    <RotateCcw className="h-4 w-4 mr-1.5" /> Descartar Cambios
                  </Button>
                  <Button onClick={handleSaveRecipe} disabled={saving} className="bg-primary">
                    <Save className="h-4 w-4 mr-1.5" /> {saving ? 'Guardando...' : 'Guardar y Recalcular'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="h-full flex items-center justify-center border-dashed p-12">
              <div className="text-center space-y-3">
                <div className="h-12 w-12 bg-muted rounded-full flex items-center justify-center mx-auto text-muted-foreground">
                  <Zap className="h-6 w-6" />
                </div>
                <h3 className="text-sm font-bold text-foreground">Ningún Producto Seleccionado</h3>
                <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                  Seleccioná un producto del catálogo de la izquierda para ver, editar o diseñar su fórmula de elaboración.
                </p>
              </div>
            </Card>
          )}
        </div>
      </div>
      <ConfirmDialog />
    </div>
  );
};

export default Recipes;
