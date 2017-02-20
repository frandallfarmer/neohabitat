package org.made.neohabitat;

import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.JSONLiteral;

/**
 * an Elko Habitat superclass to handle trapezoid types
 * 
 * 1988 PL1 didn't understand classes. Chip wrote the Habitat code, simulating
 * structures, classes, and a form of class inheritance by concatenating include
 * files and careful management of procedure references.
 * 
 * There are no default verb methods here, as this field is simply interrogated
 * by other operations.
 */
public abstract class Polygonal extends HabitatMod {

	/** All Polygonal (trapezoids) use the y coordinate and height along with 4 x coordinates to bound the shape. */
	 protected int trapezoid_type = 0;
	 protected int upper_left_x   = 0;
	 protected int upper_right_x  = 0;
	 protected int lower_left_x   = 0;
	 protected int lower_right_x  = 0;
	 protected int height		  = 0;

    
	 public Polygonal(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
			 OptInteger trapezoid_type, OptInteger upper_left_x,  OptInteger upper_right_x,
			 OptInteger lower_left_x,   OptInteger lower_right_x, OptInteger height) {
		 super(style, x, y, orientation, gr_state);
		 setPolygonalState(
				 trapezoid_type.value(0),
				 upper_left_x.value(0),
				 upper_right_x.value(0),
				 lower_left_x.value(0),
				 lower_right_x.value(0),
				 height.value(0));
	 }

    public Polygonal(int style, int x, int y, int orientation, int gr_state, int trapezoid_type, int upper_left_x,
        int upper_right_x, int lower_left_x, int lower_right_x, int height) {
        super(style, x, y, orientation, gr_state);
        setPolygonalState(trapezoid_type,  upper_left_x, upper_right_x,  lower_left_x,  lower_right_x,  height);
    }
    
    protected void setPolygonalState(int trapezoid_type, int upper_left_x,
        int upper_right_x, int lower_left_x, int lower_right_x, int height) {
        this.trapezoid_type = trapezoid_type;
        this.upper_left_x	= upper_left_x;
        this.upper_right_x	= upper_right_x;
        this.lower_left_x   = lower_left_x;
        this.lower_right_x  = lower_right_x;
        this.height		    = height;    	
    }

    public JSONLiteral encodePolygonal(JSONLiteral result) {
        result = super.encodeCommon(result);        
        result.addParameter("trapezoid_type", trapezoid_type);
        result.addParameter("upper_left_x"	, upper_left_x);
        result.addParameter("upper_right_x"	, upper_right_x);
        result.addParameter("lower_left_x"	, lower_left_x);
        result.addParameter("lower_right_x"	, lower_right_x);
        result.addParameter("height"		, height);
        return result;
    }
    
  }
